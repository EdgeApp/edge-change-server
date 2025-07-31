import { Counter, Gauge } from 'prom-client'
import WebSocket from 'ws'

import { messageToString } from './messageToString'
import { Logger } from './types'
import { AddressPlugin } from './types/addressPlugin'
import {
  changeProtocol,
  SubscribeParams,
  SubscribeResult
} from './types/changeProtocol'

const pluginGauge = new Gauge({
  name: 'change_plugin_count',
  help: 'Active change-server plugins',
  labelNames: ['pluginId'] as const
})

const connectionGauge = new Gauge({
  name: 'change_connection_count',
  help: 'Active websocket connections'
})

const subscriptionGauge = new Gauge({
  name: 'change_subscription_count',
  help: 'Active address subscriptions',
  labelNames: ['pluginId'] as const
})

const eventCounter = new Counter({
  name: 'change_event_count',
  help: 'Total number of change events sent',
  labelNames: ['pluginId'] as const
})

export interface AddressHub {
  handleConnection: (ws: WebSocket) => void
}

export interface AddressHubOpts {
  plugins: AddressPlugin[]
  logger?: Logger
}

interface PluginRow {
  /**  Maps address to socketIds */
  addressSubscriptions: Map<string, Set<number>>
  plugin: AddressPlugin
}

/**
 * Manages active subscriptions.
 * Keeps track of which sockets subscribe to which addresses,
 * and automatically unsubscribes if the socket closes,
 * handling cases where multiple clients subscribe to the same address.
 */
export function makeAddressHub(opts: AddressHubOpts): AddressHub {
  const { plugins } = opts
  let nextSocketId = 0

  // Maps socketId to changeProtocol server codec:
  const codecMap = new Map<
    number,
    ReturnType<typeof changeProtocol.makeServerCodec>
  >()

  // Maps pluginId to PluginRow:
  const pluginMap = new Map<string, PluginRow>()

  // Build our tables:
  for (const plugin of plugins) {
    const { pluginId } = plugin
    const pluginRow: PluginRow = {
      addressSubscriptions: new Map(),
      plugin
    }

    plugin.on('update', ({ address, checkpoint }) => {
      eventCounter.inc({ pluginId })
      const socketIds = pluginRow.addressSubscriptions.get(address)
      if (socketIds == null) return
      for (const socketId of socketIds) {
        const codec = codecMap.get(socketId)
        if (codec == null) continue
        console.log(`WebSocket ${process.pid}.${socketId} update`)
        codec.remoteMethods.update([pluginId, address, checkpoint])
      }
    })

    plugin.on('subLost', params => {
      pluginGauge.dec({ pluginId })
      for (const address of params.addresses) {
        const socketIds = pluginRow.addressSubscriptions.get(address)
        if (socketIds == null) continue
        for (const socketId of socketIds) {
          const codec = codecMap.get(socketId)
          if (codec == null) continue
          codec.remoteMethods.subLost([pluginId, address])
        }
        pluginRow.addressSubscriptions.delete(address)
      }
    })

    pluginMap.set(pluginId, pluginRow)
  }

  /**
   * Unsubscribes to an address on a plugin and cleans up the address
   * subscription for a PluginRow.
   */
  async function subscribeClientToPluginAddress(
    socketId: number,
    pluginRow: PluginRow,
    address: string
  ): Promise<boolean> {
    const socketIds = pluginRow.addressSubscriptions.get(address)
    if (socketIds == null) {
      // We are not subscribed, so do that now:
      pluginRow.addressSubscriptions.set(address, new Set([socketId]))
      subscriptionGauge.set(
        { pluginId: pluginRow.plugin.pluginId },
        pluginRow.addressSubscriptions.size
      )
      return await pluginRow.plugin.subscribe(address)
    } else {
      // We are already subscribed, so just note the socket:
      socketIds.add(socketId)
      return true
    }
  }

  /**
   * Unsubscribes to an address on a plugin and cleans up the address
   * subscription for a PluginRow.
   */
  async function unsubscribeClientsToPluginAddress(
    pluginRow: PluginRow,
    address: string
  ): Promise<boolean> {
    pluginRow.addressSubscriptions.delete(address)
    subscriptionGauge.set(
      { pluginId: pluginRow.plugin.pluginId },
      pluginRow.addressSubscriptions.size
    )
    return await pluginRow.plugin.unsubscribe(address)
  }

  return {
    handleConnection(ws: WebSocket): void {
      const socketId = nextSocketId++

      const logPrefix = `WebSocket ${process.pid}.${socketId} `
      const logger: Logger = {
        log: (...args: unknown[]): void => {
          opts.logger?.log(logPrefix, ...args)
        },
        error: (...args: unknown[]): void => {
          opts.logger?.error(logPrefix, ...args)
        },
        warn: (...args: unknown[]): void => {
          opts.logger?.warn(logPrefix, ...args)
        }
      }

      connectionGauge.inc()
      logger.log('connected')

      const codec = changeProtocol.makeServerCodec({
        handleError(error) {
          logger.error(`send error: ${String(error)}`)
          ws.close(1011, 'Internal error')
        },

        async handleSend(text) {
          ws.send(text)
        },

        localMethods: {
          async subscribe(
            params: SubscribeParams[]
          ): Promise<SubscribeResult[]> {
            logger.log(`subscribing ${params.length}`)

            // Do the initial scan:
            const result = await Promise.all(
              params.map(
                async (param): Promise<SubscribeResult> => {
                  const [pluginId, address, checkpoint] = param
                  const pluginRow = pluginMap.get(pluginId)
                  if (pluginRow == null) return -1 // No support

                  // Subscribe to the addresses:
                  const success = await subscribeClientToPluginAddress(
                    socketId,
                    pluginRow,
                    address
                  )
                  if (!success) return 0 // Failed for whatever reason

                  // If the plugin can't scan, let the client do it:
                  if (pluginRow.plugin.scanAddress == null) return 2

                  const changed = await pluginRow.plugin
                    .scanAddress(address, checkpoint)
                    .catch(error => {
                      logger.warn('Scan address failed: ' + String(error))
                      return true
                    })
                  return changed ? 2 : 1
                }
              )
            )

            logger.log(`subscribed ${params.length}`)

            return result
          },

          async unsubscribe(params: SubscribeParams[]): Promise<undefined> {
            logger.log(`unsubscribed ${params.length}`)

            for (const param of params) {
              const [pluginId, address] = param
              const pluginRow = pluginMap.get(pluginId)
              if (pluginRow == null) continue

              const socketIds = pluginRow.addressSubscriptions.get(address)
              if (socketIds == null || !socketIds.has(socketId)) continue
              socketIds.delete(socketId)

              // Actually unsubscribe if the list is empty:
              if (socketIds.size < 1) {
                await unsubscribeClientsToPluginAddress(pluginRow, address)
              }
            }

            return undefined
          }
        }
      })

      // Save the codec for notifications:
      codecMap.set(socketId, codec)

      ws.on('close', () => {
        logger.log(`closed`)
        connectionGauge.dec()

        // Cleanup the server codec:
        codec.handleClose()

        // Cleanup the codec map:
        codecMap.delete(socketId)

        // Search & destroy any subscriptions:
        for (const [, pluginRow] of pluginMap.entries()) {
          for (const [address, socketIds] of pluginRow.addressSubscriptions) {
            if (!socketIds.has(socketId)) continue
            socketIds.delete(socketId)

            // Actually unsubscribe if the list is empty:
            if (socketIds.size < 1) {
              unsubscribeClientsToPluginAddress(pluginRow, address).catch(
                error => {
                  console.error('unsubscribe error:', error)
                }
              )
            }
          }
        }
      })

      ws.on('error', error => {
        logger.error(`connection error: ${String(error)}`)
      })

      ws.on('message', message => {
        codec.handleMessage(messageToString(message))
      })
    }
  }
}
