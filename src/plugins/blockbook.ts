import { makePeriodicTask } from 'edge-server-tools'
import { Counter } from 'prom-client'
import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { messageToString } from '../messageToString'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import {
  blockbookProtocol,
  BlockbookProtocolServer
} from '../types/blockbookProtocol'
import { getAddressPrefix } from '../util/addressUtils'
import { makeLogger } from '../util/logger'
import { snooze } from '../util/snooze'

const MAX_ADDRESS_COUNT_PER_CONNECTION = 100

const pluginConnectionCounter = new Counter({
  name: 'change_blockbook_websocket_connection_count',
  help: 'Total number of WebSocket connections',
  labelNames: ['pluginId', 'url'] as const
})
const pluginDisconnectionCounter = new Counter({
  name: 'change_blockbook_websocket_disconnection_count',
  help: 'Total number of WebSocket disconnections',
  labelNames: ['pluginId', 'url'] as const
})
const pluginErrorCounter = new Counter({
  name: 'change_blockbook_error_count',
  help: 'Total number of WebSocket errors handled',
  labelNames: ['pluginId', 'url'] as const
})

export interface BlockbookOptions {
  pluginId: string

  /** The actual connection URL */
  url: string
}

interface Connection {
  addresses: string[]
  codec: ReturnType<typeof blockbookProtocol.makeClientCodec>
  socketReady: Promise<void>
  ws: WebSocket
}

export function makeBlockbook(opts: BlockbookOptions): AddressPlugin {
  const { pluginId, url } = opts

  const [on, emit] = makeEvents<PluginEvents>()

  const addressToConnection = new Map<string, Connection>()
  const connections: Connection[] = []
  // Map of address to unconfirmed txids for tracking mempool transactions
  const unconfirmedTxWatchlist = new Map<string, Set<string>>()
  // Global connection for block notifications
  let blockConnection: Connection | null = null
  // Flag to prevent reconnection after destroy
  let destroyed = false

  const getBlockConnectionReconnectDelay = (() => {
    const ROUGH_RECONNECTION_TIME = 3000
    let lastReconnectTime = 0
    let currentDelay = 1000
    return (): number => {
      // Step-off algorithm:
      // Delay for 1 second, then double the delay if reconnecting within the delay period
      // Reset back to 1 second if outside the delay period.
      const now = Date.now()
      // If we're reconnecting within the current delay period, double the delay
      if (now - lastReconnectTime < currentDelay + ROUGH_RECONNECTION_TIME) {
        currentDelay *= 2
      } else {
        // Reset delay if we're outside the delay period
        currentDelay = 1000
      }
      lastReconnectTime = now
      // Max delay of 60 seconds
      return Math.min(currentDelay, 60000)
    }
  })()

  const logger = makeLogger('blockbook', pluginId)

  function makeConnection(): Connection {
    const ws = new WebSocket(url)
    const codec = blockbookProtocol.makeClientCodec({
      handleError,
      async handleSend(text) {
        ws.send(text)
      },
      localMethods: {
        subscribeAddresses,
        subscribeNewBlock
      }
    })
    ws.on('message', message => {
      const text = messageToString(message)
      codec.handleMessage(text)
    })
    const socketReady = new Promise<void>(resolve => {
      ws.on('open', () => {
        pluginConnectionCounter.inc({ pluginId, url })
        resolve()
      })
    })
    ws.on('close', () => {
      pluginDisconnectionCounter.inc({ pluginId, url })

      if (connection === blockConnection) {
        // If this was the block connection, re-init it (unless destroyed).
        blockConnection = null
        if (!destroyed) {
          snooze(getBlockConnectionReconnectDelay())
            .then(() => initBlockConnection())
            .catch(err => {
              logger.error({ err }, 'Failed to re-initialize block connection')
            })
        }
      } else {
        // If this is a connection for a plugin, remove it and emit a subLost event.
        codec.handleClose()
        // Remove connection from connections array
        connections.splice(connections.indexOf(connection), 1)
        // Remove connection from addressToConnection map and clean up watchlist
        for (const address of connection.addresses) {
          addressToConnection.delete(address)
          unconfirmedTxWatchlist.delete(address)
        }
        emit('subLost', { addresses: connection.addresses })
      }
    })
    ws.on('error', handleError)
    const connection: Connection = {
      addresses: [],
      codec,
      socketReady,
      ws
    }
    return connection
  }

  // Initialize a dedicated connection for block notifications
  function initBlockConnection(): void {
    if (destroyed || blockConnection !== null) return

    blockConnection = makeConnection()

    blockConnection.socketReady
      .then(() => {
        // Subscribe to new blocks when the socket is open
        blockConnection?.codec.remoteMethods
          .subscribeNewBlock(undefined)
          .then(result => {
            if (result.subscribed) {
              logger.info('Block connection initialized')
            } else {
              logger.error('Failed to subscribe to new blocks')
            }
          })
          .catch(handleError)
      })
      .catch(handleError)
  }

  function watchUnconfirmedTx(address: string, txid: string): void {
    if (!unconfirmedTxWatchlist.has(address)) {
      unconfirmedTxWatchlist.set(address, new Set())
    }
    unconfirmedTxWatchlist.get(address)?.add(txid)
  }

  function setAddressConnection(address: string): Connection {
    let connection: Connection = connections[connections.length - 1]
    if (
      connection == null ||
      connection.addresses.length === MAX_ADDRESS_COUNT_PER_CONNECTION
    ) {
      connection = makeConnection()
      connections.push(connection)
    }
    connection.addresses.push(address)
    addressToConnection.set(address, connection)
    return connection
  }

  function removeAddressConnection(address: string): Connection | undefined {
    const connection = addressToConnection.get(address)
    if (connection == null) return
    const addressIndex = connection.addresses.indexOf(address)
    connection.addresses.splice(addressIndex, 1)
    addressToConnection.delete(address)
    unconfirmedTxWatchlist.delete(address)
    if (connection.addresses.length === 0) {
      connection.ws.close()
      connections.splice(connections.indexOf(connection), 1)
    }
    return connection
  }

  function handleError(error: unknown): void {
    // Log to Prometheus:
    pluginErrorCounter.inc({ pluginId, url })

    logger.warn({ err: error }, 'WebSocket error')
  }
  function subscribeAddresses({
    address,
    tx
  }: Parameters<
    BlockbookProtocolServer['remoteMethods']['subscribeAddresses']
  >[0]): void {
    logger.info(
      { addr: getAddressPrefix(address), txid: getAddressPrefix(tx.txid) },
      'tx detected'
    )
    // Add the tx hash to a list of unconfirmed transactions
    watchUnconfirmedTx(address, tx.txid)
    emit('update', { address })
  }

  function subscribeNewBlock({
    height
  }: Parameters<
    BlockbookProtocolServer['remoteMethods']['subscribeNewBlock']
  >[0]): void {
    logger.info({ blockNum: height.toString() }, 'block')
    // Check unconfirmed transactions and update clients
    for (const [
      address,
      unconfirmedTxids
    ] of unconfirmedTxWatchlist.entries()) {
      const connection = addressToConnection.get(address)
      if (connection == null) continue

      connection.codec.remoteMethods
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
            logger.error(
              `Expected transactions for getAccountInfo query with 'txs' details parameter`
            )
            return
          }

          let hadConfirmation = false
          // Remove confirmed transactions from unconfirmed set
          for (const tx of result.transactions) {
            if (unconfirmedTxids.has(tx.txid) && tx.confirmations > 0) {
              hadConfirmation = true
              unconfirmedTxids.delete(tx.txid)
            }
          }

          if (unconfirmedTxids.size === 0) {
            // No more unconfirmed txs, remove address from map
            unconfirmedTxWatchlist.delete(address)
          }

          // Only emit update if a transaction was confirmed
          if (hadConfirmation) {
            emit('update', { address, checkpoint: height.toString() })
          }
        })
        .catch((error: unknown) => handleError(error))
    }
  }

  // Initialize block connection at startup
  initBlockConnection()

  const pingTask = makePeriodicTask(() => {
    // Ping all address connections
    for (const connection of connections) {
      connection.socketReady
        .then(async () => {
          await connection.codec.remoteMethods.ping(undefined)
        })
        .catch(error => {
          logger.error({ err: error }, 'ping error')
        })
    }

    // Ping block connection separately
    if (blockConnection !== null) {
      blockConnection.socketReady
        .then(async () => {
          await blockConnection?.codec.remoteMethods.ping(undefined)
        })
        .catch(error => {
          logger.error({ err: error }, 'block connection ping error')
        })
    }
  }, 50000)
  pingTask.start()

  const blockbookPlugin: AddressPlugin = {
    pluginId,
    on,

    async subscribe(address) {
      const connection =
        addressToConnection.get(address) ?? setAddressConnection(address)
      await connection.socketReady
      const result = await connection.codec.remoteMethods.subscribeAddresses({
        addresses: connection.addresses
      })
      return result.subscribed
    },

    async unsubscribe(address) {
      const connection = removeAddressConnection(address)
      if (connection == null || connection.addresses.length === 0) return false
      await connection.socketReady
      const result = await connection.codec.remoteMethods.unsubscribeAddresses({
        addresses: connection.addresses
      })
      return result.subscribed
    },

    async scanAddress(address, checkpoint): Promise<boolean> {
      const connection = addressToConnection.get(address)
      if (connection == null) {
        throw new Error(`Missing connection for address: ${address}`)
      }
      await connection.socketReady
      const out = await connection.codec.remoteMethods.getAccountInfo({
        descriptor: address,
        details: 'txs',
        tokens: undefined,
        from: checkpoint == null ? checkpoint : parseInt(checkpoint),
        to: undefined,
        page: undefined,
        pageSize: undefined,
        contractFilter: undefined,
        secondaryCurrency: undefined,
        gap: undefined
      })

      // Add unconfirmed txs to the the watchlist
      const transactions = out.transactions ?? []
      for (const tx of transactions) {
        if (tx.confirmations < 0) {
          watchUnconfirmedTx(address, tx.txid)
        }
      }

      if (out.unconfirmedTxs > 0) return true
      if (out.transactions != null && out.transactions.length > 0) return true
      return false
    },

    destroy() {
      destroyed = true
      pingTask.stop()

      // Close all address connections
      for (const connection of connections) {
        connection.codec.handleClose()
        connection.ws.close()
      }
      connections.length = 0
      addressToConnection.clear()
      unconfirmedTxWatchlist.clear()

      // Close block connection
      if (blockConnection !== null) {
        blockConnection.codec.handleClose()
        blockConnection.ws.close()
        blockConnection = null
      }
    }
  }

  return blockbookPlugin
}
