import { Counter } from 'prom-client'
import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { messageToString } from '../messageToString'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { blockbookProtocol } from '../types/blockbookProtocol'

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

  /** A clean URL for logging */
  safeUrl?: string

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
  const { pluginId, safeUrl = opts.url, url } = opts

  const [on, emit] = makeEvents<PluginEvents>()

  const addressToConnection = new Map<string, Connection>()
  const connections: Connection[] = []

  const logPrefix = `${pluginId} (${safeUrl}):`
  const logger = {
    log: (...args: unknown[]): void => {
      console.log(logPrefix, ...args)
    },
    error: (...args: unknown[]): void => {
      console.error(logPrefix, ...args)
    },
    warn: (...args: unknown[]): void => {
      console.warn(logPrefix, ...args)
    }
  }

  function makeConnection(): Connection {
    const ws = new WebSocket(url)
    const codec = blockbookProtocol.makeClientCodec({
      handleError,
      async handleSend(text) {
        ws.send(text)
      },
      localMethods: {
        subscribeAddresses
      }
    })
    ws.on('message', message => {
      const text = messageToString(message)
      codec.handleMessage(text)
    })
    const socketReady = new Promise<void>(resolve => {
      ws.on('open', () => {
        pluginConnectionCounter.inc({ pluginId, url: safeUrl })
        resolve()
      })
    })
    ws.on('close', () => {
      pluginDisconnectionCounter.inc({ pluginId, url: safeUrl })
      codec.handleClose()
      // Remove connection from connections array
      connections.splice(connections.indexOf(connection), 1)
      // Remove connection from addressToConnection map
      for (const address of connection.addresses) {
        addressToConnection.delete(address)
      }
      emit('subLost', { addresses: connection.addresses })
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
    if (connection.addresses.length === 0) {
      connection.ws.close()
      connections.splice(connections.indexOf(connection), 1)
    }
    return connection
  }

  function handleError(error: unknown): void {
    // Log to Prometheus:
    pluginErrorCounter.inc({ pluginId, url: safeUrl })

    logger.warn('WebSocket error:', error)
  }
  function subscribeAddresses({ address }: { address: string }): void {
    emit('update', { address })
  }

  setInterval(() => {
    for (const connection of connections) {
      connection.codec.remoteMethods.ping(undefined).catch(error => {
        logger.error('ping error:', error)
      })
    }
  }, 50000)

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
      if (connection == null) return false
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
        details: 'txids',
        tokens: undefined,
        from: checkpoint == null ? checkpoint : parseInt(checkpoint),
        to: undefined,
        page: undefined,
        pageSize: undefined,
        contractFilter: undefined,
        secondaryCurrency: undefined,
        gap: undefined
      })

      if (out.unconfirmedTxs > 0) return true
      if (out.txids != null && out.txids.length > 0) return true
      return false
    }
  }

  return blockbookPlugin
}
