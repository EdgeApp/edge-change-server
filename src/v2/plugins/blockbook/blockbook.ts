// src/v2/plugins/blockbook/blockbook.ts

import { makePeriodicTask } from 'edge-server-tools'
import WebSocket from 'ws'

import { messageToString } from '../../../messageToString'
import { serverConfig } from '../../../serverConfig'
import {
  blockbookProtocol,
  BlockbookProtocolServer
} from '../../../types/blockbookProtocol'
import { getAddressPrefix } from '../../../util/addressUtils'
import { makeLogger } from '../../../util/logger'
import { snooze } from '../../../util/snooze'
import {
  cleanupConnection,
  makeSubscriptionState,
  PluginSubscriptionState,
  trackSubscription,
  untrackSubscription
} from '../../plugin/subscriptionState'
import {
  PluginApi,
  PluginCallbacks,
  PluginFactory,
  SubscribeRequest,
  SubscribeResult,
  UnsubscribeRequest
} from '../../types/pluginTypes'

const MAX_ADDRESS_COUNT_PER_CONNECTION = 100

/** Chain configuration for Blockbook */
interface ChainConfig {
  pluginId: string
  url: string
}

/** All supported Blockbook chains */
const chainConfigs: ChainConfig[] = [
  {
    pluginId: 'bitcoin',
    url: 'wss://btcbook.nownodes.io/wss/{nowNodesApiKey}'
  },
  {
    pluginId: 'bitcoincash',
    url: 'wss://bchbook.nownodes.io/wss/{nowNodesApiKey}'
  },
  {
    pluginId: 'dogecoin',
    url: 'wss://dogebook.nownodes.io/wss/{nowNodesApiKey}'
  },
  {
    pluginId: 'litecoin',
    url: 'wss://ltcbook.nownodes.io/wss/{nowNodesApiKey}'
  },
  {
    pluginId: 'qtum',
    url: 'wss://qtum-blockbook.nownodes.io/wss/{nowNodesApiKey}'
  }
]

interface BlockbookConnection {
  addresses: string[]
  codec: ReturnType<typeof blockbookProtocol.makeClientCodec>
  socketReady: Promise<void>
  ws: WebSocket
}

interface ChainInstance {
  config: ChainConfig
  connectionUrl: string
  logUrl: string
  addressToConnection: Map<string, BlockbookConnection>
  connections: BlockbookConnection[]
  unconfirmedTxWatchlist: Map<string, Set<string>>
  blockConnection: BlockbookConnection | null
  destroyed: boolean
  getBlockConnectionReconnectDelay: () => number
}

export const blockbookPluginFactory: PluginFactory = {
  name: 'blockbook',
  chainPluginIds: chainConfigs.map(c => c.pluginId),

  makePlugin: async (callbacks: PluginCallbacks): Promise<PluginApi> => {
    const logger = makeLogger('blockbook')

    // Per-pluginId subscription state (for connection tracking)
    const subscriptionStates = new Map<string, PluginSubscriptionState>()

    // Per-pluginId chain instances
    const chainInstances = new Map<string, ChainInstance>()

    // Ping task for all connections
    const pingTask = makePeriodicTask(() => {
      for (const instance of chainInstances.values()) {
        // Ping address connections
        for (const connection of instance.connections) {
          connection.socketReady
            .then(async () => {
              await connection.codec.remoteMethods.ping(undefined)
            })
            .catch(error => {
              logger.error(`ping error: ${String(error)}`)
            })
        }

        // Ping block connection
        if (instance.blockConnection !== null) {
          instance.blockConnection.socketReady
            .then(async () => {
              await instance.blockConnection?.codec.remoteMethods.ping(
                undefined
              )
            })
            .catch(error => {
              logger.error(`block connection ping error: ${String(error)}`)
            })
        }
      }
    }, 50000)

    // Initialize chain instances
    for (const config of chainConfigs) {
      const chainLogger = makeLogger('blockbook', config.pluginId)

      const connectionUrl =
        serverConfig.nowNodesApiKey != null
          ? config.url.replace('{nowNodesApiKey}', serverConfig.nowNodesApiKey)
          : config.url

      const getBlockConnectionReconnectDelay = (() => {
        const ROUGH_RECONNECTION_TIME = 3000
        let lastReconnectTime = 0
        let currentDelay = 1000
        return (): number => {
          const now = Date.now()
          if (
            now - lastReconnectTime <
            currentDelay + ROUGH_RECONNECTION_TIME
          ) {
            currentDelay *= 2
          } else {
            currentDelay = 1000
          }
          lastReconnectTime = now
          return Math.min(currentDelay, 60000)
        }
      })()

      const instance: ChainInstance = {
        config,
        connectionUrl,
        logUrl: config.url,
        addressToConnection: new Map(),
        connections: [],
        unconfirmedTxWatchlist: new Map(),
        blockConnection: null,
        destroyed: false,
        getBlockConnectionReconnectDelay
      }

      function makeConnection(): BlockbookConnection {
        const ws = new WebSocket(instance.connectionUrl)
        const codec = blockbookProtocol.makeClientCodec({
          handleError: (error: unknown) => {
            chainLogger.warn(`WebSocket error: ${String(error)}`)
          },
          async handleSend(text) {
            ws.send(text)
          },
          localMethods: {
            subscribeAddresses({
              address,
              tx
            }: Parameters<
              BlockbookProtocolServer['remoteMethods']['subscribeAddresses']
            >[0]): void {
              chainLogger({
                addr: getAddressPrefix(address),
                txid: getAddressPrefix(tx.txid),
                t: 'tx detected'
              })
              // Track unconfirmed tx
              if (!instance.unconfirmedTxWatchlist.has(address)) {
                instance.unconfirmedTxWatchlist.set(address, new Set())
              }
              instance.unconfirmedTxWatchlist.get(address)?.add(tx.txid)
              // Notify via callback
              callbacks.onUpdate(config.pluginId, address)
            },
            subscribeNewBlock({
              height
            }: Parameters<
              BlockbookProtocolServer['remoteMethods']['subscribeNewBlock']
            >[0]): void {
              chainLogger({ blockNum: height.toString(), t: 'block' })

              // Check unconfirmed transactions
              for (const [
                address,
                unconfirmedTxids
              ] of instance.unconfirmedTxWatchlist.entries()) {
                const conn = instance.addressToConnection.get(address)
                if (conn == null) continue

                conn.codec.remoteMethods
                  .getAccountInfo({
                    descriptor: address,
                    details: 'txslight',
                    tokens: undefined,
                    page: undefined,
                    pageSize: undefined,
                    from: undefined,
                    to: undefined,
                    contractFilter: undefined,
                    secondaryCurrency: undefined,
                    gap: undefined
                  })
                  .then(result => {
                    if (result.transactions === undefined) {
                      chainLogger.error(
                        `Expected transactions for getAccountInfo query`
                      )
                      return
                    }

                    let hadConfirmation = false
                    for (const tx of result.transactions) {
                      if (
                        unconfirmedTxids.has(tx.txid) &&
                        tx.confirmations > 0
                      ) {
                        hadConfirmation = true
                        unconfirmedTxids.delete(tx.txid)
                      }
                    }

                    if (unconfirmedTxids.size === 0) {
                      instance.unconfirmedTxWatchlist.delete(address)
                    }

                    if (hadConfirmation) {
                      callbacks.onUpdate(
                        config.pluginId,
                        address,
                        height.toString()
                      )
                    }
                  })
                  .catch((error: unknown) => {
                    chainLogger.warn(`getAccountInfo error: ${String(error)}`)
                  })
              }
            }
          }
        })

        ws.on('message', message => {
          const text = messageToString(message)
          codec.handleMessage(text)
        })

        const socketReady = new Promise<void>(resolve => {
          ws.on('open', () => resolve())
        })

        ws.on('close', () => {
          if (connection === instance.blockConnection) {
            instance.blockConnection = null
            if (!instance.destroyed) {
              snooze(instance.getBlockConnectionReconnectDelay())
                .then(() => initBlockConnection())
                .catch(err => {
                  chainLogger.error(
                    `Failed to re-initialize block connection: ${String(err)}`
                  )
                })
            }
          } else {
            codec.handleClose()
            const idx = instance.connections.indexOf(connection)
            if (idx >= 0) instance.connections.splice(idx, 1)
            for (const address of connection.addresses) {
              instance.addressToConnection.delete(address)
              instance.unconfirmedTxWatchlist.delete(address)
            }
            callbacks.onSubLost(config.pluginId, connection.addresses)
          }
        })

        ws.on('error', (error: unknown) => {
          chainLogger.warn(`WebSocket error: ${String(error)}`)
        })

        const connection: BlockbookConnection = {
          addresses: [],
          codec,
          socketReady,
          ws
        }
        return connection
      }

      function initBlockConnection(): void {
        if (instance.destroyed || instance.blockConnection !== null) return

        instance.blockConnection = makeConnection()

        instance.blockConnection.socketReady
          .then(() => {
            instance.blockConnection?.codec.remoteMethods
              .subscribeNewBlock(undefined)
              .then(result => {
                if (result.subscribed) {
                  chainLogger('Block connection initialized')
                } else {
                  chainLogger.error('Failed to subscribe to new blocks')
                }
              })
              .catch((err: unknown) => {
                chainLogger.warn(`subscribeNewBlock error: ${String(err)}`)
              })
          })
          .catch((err: unknown) => {
            chainLogger.warn(`Block connection error: ${String(err)}`)
          })
      }

      // Store helpers on instance for later use
      ;(instance as any).makeConnection = makeConnection
      ;(instance as any).initBlockConnection = initBlockConnection

      // Initialize block connection
      initBlockConnection()

      chainInstances.set(config.pluginId, instance)
      subscriptionStates.set(config.pluginId, makeSubscriptionState())
    }

    // Start ping task
    pingTask.start()

    const plugin: PluginApi = {
      pluginIds: chainConfigs.map(c => c.pluginId),

      subscribe: async (
        request: SubscribeRequest
      ): Promise<SubscribeResult[]> => {
        const results: SubscribeResult[] = []

        for (const sub of request.subscriptions) {
          const instance = chainInstances.get(sub.pluginId)
          const state = subscriptionStates.get(sub.pluginId)

          if (instance == null || state == null) {
            for (const addr of sub.addresses) {
              results.push({
                pluginId: sub.pluginId,
                address: addr.address,
                result: -1
              })
            }
            continue
          }

          const makeConnection = (instance as any)
            .makeConnection as () => BlockbookConnection

          for (const addr of sub.addresses) {
            const isNew = trackSubscription(
              state,
              request.connectionId,
              addr.address
            )

            if (isNew) {
              // First subscriber - create blockbook connection
              let connection =
                instance.connections[instance.connections.length - 1]
              if (
                connection == null ||
                connection.addresses.length === MAX_ADDRESS_COUNT_PER_CONNECTION
              ) {
                connection = makeConnection()
                instance.connections.push(connection)
              }
              connection.addresses.push(addr.address)
              instance.addressToConnection.set(addr.address, connection)

              // Subscribe to blockbook
              try {
                await connection.socketReady
                await connection.codec.remoteMethods.subscribeAddresses({
                  addresses: connection.addresses
                })
              } catch (error) {
                results.push({
                  pluginId: sub.pluginId,
                  address: addr.address,
                  result: 0
                })
                continue
              }
            }

            // Scan for changes
            let hasChanges = true
            if (addr.checkpoint != null) {
              try {
                hasChanges = await scanAddress(
                  instance,
                  addr.address,
                  addr.checkpoint
                )
              } catch {
                hasChanges = true
              }
            }

            results.push({
              pluginId: sub.pluginId,
              address: addr.address,
              result: hasChanges ? 2 : 1
            })
          }
        }

        return results
      },

      unsubscribe: async (request: UnsubscribeRequest): Promise<void> => {
        for (const sub of request.subscriptions) {
          const instance = chainInstances.get(sub.pluginId)
          const state = subscriptionStates.get(sub.pluginId)

          if (instance == null || state == null) continue

          for (const address of sub.addresses) {
            const shouldUnsubscribe = untrackSubscription(
              state,
              request.connectionId,
              address
            )

            if (shouldUnsubscribe) {
              const connection = instance.addressToConnection.get(address)
              if (connection != null) {
                const idx = connection.addresses.indexOf(address)
                if (idx >= 0) connection.addresses.splice(idx, 1)
                instance.addressToConnection.delete(address)
                instance.unconfirmedTxWatchlist.delete(address)

                if (connection.addresses.length === 0) {
                  connection.ws.close()
                  const connIdx = instance.connections.indexOf(connection)
                  if (connIdx >= 0) instance.connections.splice(connIdx, 1)
                } else {
                  // Re-subscribe without this address
                  try {
                    await connection.socketReady
                    await connection.codec.remoteMethods.subscribeAddresses({
                      addresses: connection.addresses
                    })
                  } catch {
                    // Ignore errors
                  }
                }
              }
            }
          }
        }
      },

      connectionClosed: async (connectionId: string): Promise<void> => {
        for (const [pluginId, state] of subscriptionStates) {
          const instance = chainInstances.get(pluginId)
          if (instance == null) continue

          const addressesToRemove = cleanupConnection(state, connectionId)

          for (const address of addressesToRemove) {
            const connection = instance.addressToConnection.get(address)
            if (connection != null) {
              const idx = connection.addresses.indexOf(address)
              if (idx >= 0) connection.addresses.splice(idx, 1)
              instance.addressToConnection.delete(address)
              instance.unconfirmedTxWatchlist.delete(address)

              if (connection.addresses.length === 0) {
                connection.ws.close()
                const connIdx = instance.connections.indexOf(connection)
                if (connIdx >= 0) instance.connections.splice(connIdx, 1)
              }
            }
          }
        }
      },

      stop: async (): Promise<void> => {
        logger({ t: 'stopping blockbook plugin' })

        pingTask.stop()

        for (const instance of chainInstances.values()) {
          instance.destroyed = true

          for (const connection of instance.connections) {
            connection.codec.handleClose()
            connection.ws.close()
          }
          instance.connections.length = 0
          instance.addressToConnection.clear()
          instance.unconfirmedTxWatchlist.clear()

          if (instance.blockConnection !== null) {
            instance.blockConnection.codec.handleClose()
            instance.blockConnection.ws.close()
            instance.blockConnection = null
          }
        }

        chainInstances.clear()
        subscriptionStates.clear()
      }
    }

    return plugin
  }
}

async function scanAddress(
  instance: ChainInstance,
  address: string,
  checkpoint: string
): Promise<boolean> {
  const connection = instance.addressToConnection.get(address)
  if (connection == null) {
    throw new Error(`Missing connection for address: ${address}`)
  }

  await connection.socketReady
  const out = await connection.codec.remoteMethods.getAccountInfo({
    descriptor: address,
    details: 'txs',
    tokens: undefined,
    from: parseInt(checkpoint),
    to: undefined,
    page: undefined,
    pageSize: undefined,
    contractFilter: undefined,
    secondaryCurrency: undefined,
    gap: undefined
  })

  // Track unconfirmed txs
  const transactions = out.transactions ?? []
  for (const tx of transactions) {
    if (tx.confirmations < 0) {
      if (!instance.unconfirmedTxWatchlist.has(address)) {
        instance.unconfirmedTxWatchlist.set(address, new Set())
      }
      instance.unconfirmedTxWatchlist.get(address)?.add(tx.txid)
    }
  }

  if (out.unconfirmedTxs > 0) return true
  if (out.transactions != null && out.transactions.length > 0) return true
  return false
}
