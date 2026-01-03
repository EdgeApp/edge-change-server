// src/v2/hub.ts

import { randomBytes } from 'crypto'
import { Counter, Gauge } from 'prom-client'
import WebSocket from 'ws'

import { messageToString } from '../messageToString'
import {
  changeProtocol,
  SubscribeParams,
  SubscribeResult as ProtocolSubscribeResult
} from '../types/changeProtocol'
import { getAddressPrefix } from '../util/addressUtils'
import { makeLogger } from '../util/logger'
import { stackify } from '../util/stackify'
import { PluginManager } from './pluginManager'
import { SubscribeRequest, SubscribeResult } from './types/pluginTypes'

const logger = makeLogger('hub')

const connectionGauge = new Gauge({
  name: 'change_v2_connection_count',
  help: 'Active websocket connections (v2)'
})

const subscriptionGauge = new Gauge({
  name: 'change_v2_subscription_count',
  help: 'Active address subscriptions (v2)',
  labelNames: ['pluginId'] as const
})

const eventCounter = new Counter({
  name: 'change_v2_event_count',
  help: 'Total number of change events sent (v2)',
  labelNames: ['pluginId'] as const
})

export interface AddressHub {
  handleConnection: (ws: WebSocket, ip: string) => void
  destroy: () => Promise<void>
  /** Get the connections map for use with makePluginCallbacks */
  getConnections: () => Map<string, ConnectionInfo>
}

export interface AddressHubOpts {
  pluginManager: PluginManager
}

interface ConnectionInfo {
  connectionId: string
  codec: ReturnType<typeof changeProtocol.makeServerCodec>
  ip: string
  ws: WebSocket
  /** Track subscriptions per pluginId for this connection */
  subscriptions: Map<string, Set<string>>
}

/**
 * Manages active websocket connections and routes subscriptions to plugins.
 */
export function makeAddressHub(opts: AddressHubOpts): AddressHub {
  const { pluginManager } = opts

  // Maps connectionId to connection info
  const connections = new Map<string, ConnectionInfo>()

  // Subscribe to plugin updates and forward to appropriate connections
  // Note: The plugins call these callbacks when updates are detected

  return {
    handleConnection(ws: WebSocket, ip: string): void {
      const connectionId = generateConnectionId(connections)

      connectionGauge.inc()
      logger({ connectionId, ip, t: 'connected' })

      const codec = changeProtocol.makeServerCodec({
        handleError(error) {
          logger.error({
            connectionId,
            ip,
            t: `send error: ${String(error)}`
          })
          ws.close(1011, 'Internal error')
        },

        async handleSend(text) {
          ws.send(text)
        },

        localMethods: {
          async subscribe(
            params: SubscribeParams[]
          ): Promise<ProtocolSubscribeResult[]> {
            // Log all subscriptions
            const subs = params.map(([pluginId, address, checkpoint]) => ({
              pluginId,
              addr: getAddressPrefix(address),
              checkpoint
            }))
            logger({ connectionId, ip, subs, t: 'subscribe' })

            // Group by pluginId for efficient plugin calls
            const byPlugin = new Map<
              string,
              Array<{ address: string; checkpoint?: string }>
            >()
            for (const [pluginId, address, checkpoint] of params) {
              let list = byPlugin.get(pluginId)
              if (list == null) {
                list = []
                byPlugin.set(pluginId, list)
              }
              list.push({ address, checkpoint })
            }

            // Build subscribe requests per plugin
            const pluginRequests = new Map<
              ReturnType<typeof pluginManager.getPluginForId>,
              SubscribeRequest
            >()

            for (const [pluginId, addresses] of byPlugin) {
              const plugin = pluginManager.getPluginForId(pluginId)
              if (plugin == null) continue

              let request = pluginRequests.get(plugin)
              if (request == null) {
                request = { connectionId, subscriptions: [] }
                pluginRequests.set(plugin, request)
              }
              request.subscriptions.push({
                pluginId,
                addresses: addresses.map(a => ({
                  address: a.address,
                  checkpoint: a.checkpoint
                }))
              })
            }

            // Call plugins and collect results
            const pluginResults = new Map<string, SubscribeResult>()
            await Promise.all(
              Array.from(pluginRequests.entries()).map(
                async ([plugin, request]) => {
                  if (plugin == null) return
                  try {
                    const results = await plugin.subscribe(request)
                    for (const result of results) {
                      const key = `${result.pluginId}:${result.address}`
                      pluginResults.set(key, result)
                    }
                  } catch (error) {
                    logger.error({
                      connectionId,
                      ip,
                      t: `subscribe error: ${stackify(error)}`
                    })
                  }
                }
              )
            )

            // Track subscriptions locally and build response
            const results: ProtocolSubscribeResult[] = []
            for (const [pluginId, address] of params) {
              const key = `${pluginId}:${address}`
              const pluginResult = pluginResults.get(key)

              if (pluginResult == null) {
                // No plugin for this pluginId
                results.push(-1)
                continue
              }

              // Track locally
              let pluginSubs = connInfo.subscriptions.get(pluginId)
              if (pluginSubs == null) {
                pluginSubs = new Set()
                connInfo.subscriptions.set(pluginId, pluginSubs)
              }
              pluginSubs.add(address)
              subscriptionGauge.inc({ pluginId })

              results.push(pluginResult.result)
            }

            return results
          },

          async unsubscribe(params: SubscribeParams[]): Promise<undefined> {
            logger({
              connectionId,
              ip,
              count: params.length,
              t: 'unsubscribe'
            })

            // Group by pluginId
            const byPlugin = new Map<string, string[]>()
            for (const [pluginId, address] of params) {
              let list = byPlugin.get(pluginId)
              if (list == null) {
                list = []
                byPlugin.set(pluginId, list)
              }
              list.push(address)

              // Update local tracking
              const pluginSubs = connInfo.subscriptions.get(pluginId)
              if (pluginSubs?.has(address) === true) {
                pluginSubs.delete(address)
                subscriptionGauge.dec({ pluginId })
              }
            }

            // Build unsubscribe requests per plugin
            const pluginRequests = new Map<
              ReturnType<typeof pluginManager.getPluginForId>,
              {
                connectionId: string
                subscriptions: Array<{ pluginId: string; addresses: string[] }>
              }
            >()

            for (const [pluginId, addresses] of byPlugin) {
              const plugin = pluginManager.getPluginForId(pluginId)
              if (plugin == null) continue

              let request = pluginRequests.get(plugin)
              if (request == null) {
                request = { connectionId, subscriptions: [] }
                pluginRequests.set(plugin, request)
              }
              request.subscriptions.push({ pluginId, addresses })
            }

            // Call plugins
            await Promise.all(
              Array.from(pluginRequests.entries()).map(
                async ([plugin, request]) => {
                  if (plugin == null) return
                  try {
                    await plugin.unsubscribe(request)
                  } catch (error) {
                    logger.error({
                      connectionId,
                      ip,
                      t: `unsubscribe error: ${stackify(error)}`
                    })
                  }
                }
              )
            )

            return undefined
          }
        }
      })

      const connInfo: ConnectionInfo = {
        connectionId,
        codec,
        ip,
        ws,
        subscriptions: new Map()
      }
      connections.set(connectionId, connInfo)

      ws.on('close', () => {
        // Collect subscriptions for logging
        const subs: Array<{ pluginId: string; addr: string }> = []
        for (const [pluginId, addresses] of connInfo.subscriptions) {
          for (const address of addresses) {
            subs.push({ pluginId, addr: getAddressPrefix(address) })
            subscriptionGauge.dec({ pluginId })
          }
        }

        logger({ connectionId, ip, subs, t: 'closed' })
        connectionGauge.dec()

        // Cleanup codec
        codec.handleClose()

        // Remove from connections map
        connections.delete(connectionId)

        // Notify all plugins that this connection closed (fire and forget)
        const allPlugins = pluginManager.getAllPlugins()
        Promise.all(
          allPlugins.map(async plugin => {
            try {
              await plugin.connectionClosed(connectionId)
            } catch (error) {
              logger.error({
                connectionId,
                ip,
                t: `connectionClosed error: ${stackify(error)}`
              })
            }
          })
        ).catch(error => {
          logger.error({
            connectionId,
            ip,
            t: `connectionClosed error: ${stackify(error)}`
          })
        })
      })

      ws.on('error', error => {
        logger.error({
          connectionId,
          ip,
          t: `connection error: ${String(error)}`
        })
      })

      ws.on('message', message => {
        codec.handleMessage(messageToString(message))
      })
    },

    async destroy(): Promise<void> {
      // Close all connections
      for (const [connectionId, connInfo] of connections) {
        logger({ connectionId, t: 'destroying connection' })
        connInfo.codec.handleClose()
        connInfo.ws.close(1001, 'Server shutting down')
      }
      connections.clear()

      // Stop plugin manager
      await pluginManager.stop()
    },

    getConnections(): Map<string, ConnectionInfo> {
      return connections
    }
  }
}

function generateConnectionId(
  existingIds: Map<string, ConnectionInfo>
): string {
  let id: string
  do {
    id = randomBytes(3).toString('hex')
  } while (existingIds.has(id))
  return id
}

/**
 * Create callbacks object that plugins will use to notify hub of updates.
 * This is passed to the plugin manager and bridged to plugin workers.
 *
 * @param getConnections - Function that returns the connections map (deferred lookup)
 */
export function makePluginCallbacks(
  getConnections: () => Map<string, ConnectionInfo> | null
): {
  onUpdate: (pluginId: string, address: string, checkpoint?: string) => void
  onSubLost: (pluginId: string, addresses: string[]) => void
} {
  return {
    onUpdate(pluginId: string, address: string, checkpoint?: string): void {
      eventCounter.inc({ pluginId })

      const connections = getConnections()
      if (connections == null) {
        logger.warn({
          t: 'onUpdate called but connections not initialized',
          pluginId,
          addr: getAddressPrefix(address)
        })
        return
      }

      // Find all connections subscribed to this address
      for (const [, connInfo] of connections) {
        const pluginSubs = connInfo.subscriptions.get(pluginId)
        if (pluginSubs?.has(address) === true) {
          logger({
            connectionId: connInfo.connectionId,
            ip: connInfo.ip,
            pluginId,
            addr: getAddressPrefix(address),
            checkpoint,
            t: 'update'
          })
          connInfo.codec.remoteMethods.update([pluginId, address, checkpoint])
        }
      }
    },

    onSubLost(pluginId: string, addresses: string[]): void {
      const connections = getConnections()
      if (connections == null) {
        logger.warn({
          t: 'onSubLost called but connections not initialized',
          pluginId,
          addresses: addresses.length
        })
        return
      }

      // Find all connections subscribed to these addresses
      for (const [, connInfo] of connections) {
        const pluginSubs = connInfo.subscriptions.get(pluginId)
        if (pluginSubs == null) continue

        for (const address of addresses) {
          if (pluginSubs.has(address)) {
            logger({
              connectionId: connInfo.connectionId,
              ip: connInfo.ip,
              pluginId,
              addr: getAddressPrefix(address),
              t: 'subLost'
            })
            connInfo.codec.remoteMethods.subLost([pluginId, address])
            pluginSubs.delete(address)
            subscriptionGauge.dec({ pluginId })
          }
        }
      }
    }
  }
}
