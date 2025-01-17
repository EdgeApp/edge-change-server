import { Counter, Gauge } from 'prom-client'
import WebSocket from 'ws'

import { RpcCodec } from './jsonRpc'
import { messageToString } from './messageToString'
import { AddressPlugin } from './types/addressPlugin'
import {
  AddressTuple,
  changeProtocol,
  SubscribeResult
} from './types/changeProtocol'

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

interface PluginRow {
  /**  Maps from addresses to socketId's */
  addresses: Map<string, Set<number>>
  plugin: AddressPlugin
}

/**
 * Manages active subscriptions.
 * Keeps track of which sockets subscribe to which addresses,
 * and automatically unsubscribes if the socket closes,
 * handling cases where multiple clients subscribe to the same address.
 */
export function makeAddressHub(plugins: AddressPlugin[]): AddressHub {
  let nextSocketId = 0
  const codecMap = new Map<
    number,
    RpcCodec<{ update: (address: AddressTuple) => void }>
  >()

  // Index plugins by id:
  const pluginMap: { [pluginId: string]: PluginRow } = {}

  // Build our tables:
  for (const plugin of plugins) {
    const { pluginId } = plugin
    const pluginRow: PluginRow = { addresses: new Map(), plugin }
    pluginMap[plugin.pluginId] = pluginRow

    plugin.on('update', ({ address, checkpoint }) => {
      const addressRow = pluginRow.addresses.get(address)
      if (addressRow == null) return
      for (const socketId of addressRow) {
        console.log(`WebSocket ${process.pid}.${socketId} update`)
        const codec = codecMap.get(socketId)
        eventCounter.inc({ pluginId })
        codec?.remoteMethods.update([pluginId, address, checkpoint])
      }
    })
  }

  function handleConnection(ws: WebSocket): void {
    const socketId = nextSocketId++
    function log(text: string): void {
      console.log(`WebSocket ${process.pid}.${socketId} ` + text)
    }

    connectionGauge.inc()
    log('connected')

    const codec = changeProtocol.makeServerCodec({
      handleError(error) {
        log(`send error: ${String(error)}`)
        ws.close()
      },

      async handleSend(text) {
        ws.send(text)
      },

      localMethods: {
        async subscribe(params: AddressTuple[]): Promise<SubscribeResult[]> {
          log(`subscribed ${params.length}`)

          // Subscribe to the addresses:
          for (const param of params) {
            const [pluginId, address] = param
            const pluginRow = pluginMap[pluginId]
            if (pluginRow == null) continue

            const addressRow = pluginRow.addresses.get(address)
            if (addressRow == null) {
              // We are not subscribed, so do that now:
              pluginRow.addresses.set(address, new Set([socketId]))
              subscriptionGauge.set({ pluginId }, pluginRow.addresses.size)
              pluginRow.plugin.subscribe(address)
            } else {
              // We are already subscribed, so just note the socket:
              addressRow.add(socketId)
            }
          }

          // Do the initial scan:
          return await Promise.all(
            params.map<Promise<SubscribeResult>>(async param => {
              const [pluginId, address, checkpoint] = param
              const pluginRow = pluginMap[pluginId]
              if (pluginRow == null) return 0

              // If the plugin can't scan, let the client do it:
              if (pluginRow.plugin.scanAddress == null) return 2

              const changed = await pluginRow.plugin
                .scanAddress(address, checkpoint)
                .catch(() => true)
              return changed ? 2 : 1
            })
          )
        },

        async unsubscribe(params: AddressTuple[]): Promise<undefined> {
          log(`unsubscribed ${params.length}`)

          for (const param of params) {
            const [pluginId, address] = param
            const pluginRow = pluginMap[pluginId]
            if (pluginRow == null) continue

            const addressRow = pluginRow.addresses.get(address)
            if (addressRow == null || !addressRow.has(socketId)) continue
            addressRow.delete(socketId)

            // Actually unsubscribe if the list is empty:
            if (addressRow.size < 1) {
              pluginRow.addresses.delete(address)
              subscriptionGauge.set({ pluginId }, pluginRow.addresses.size)
              pluginRow.plugin.unsubscribe(address)
            }
          }

          return undefined
        }
      }
    })
    codecMap.set(socketId, codec)

    ws.on('close', () => {
      log(`closed`)
      connectionGauge.dec()
      codec.handleClose()

      // Search & destroy any subscriptions:
      for (const pluginId of Object.keys(pluginMap)) {
        const pluginRow = pluginMap[pluginId]
        for (const [address, addressRow] of pluginRow.addresses) {
          if (!addressRow.has(socketId)) continue
          addressRow.delete(socketId)

          // Actually unsubscribe if the list is empty:
          if (addressRow.size < 1) {
            pluginRow.addresses.delete(address)
            subscriptionGauge.set({ pluginId }, pluginRow.addresses.size)
            pluginRow.plugin.unsubscribe(address)
          }
        }
      }
    })

    ws.on('error', error => {
      log(`connection error: ${String(error)}`)
    })

    ws.on('message', message => {
      codec.handleMessage(messageToString(message))
    })
  }

  return { handleConnection }
}
