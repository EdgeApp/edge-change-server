import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { messageToString } from '../messageToString'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { blockbookProtocol } from '../types/blockbookProtocol'

const MAX_ADDRESS_COUNT_PER_CONNECTION = 100

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

  const addressToConnectionIndex = new Map<string, number>()
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
        emit('connect', undefined)
        resolve()
      })
    })
    ws.on('close', () => {
      codec.handleClose()
      emit('disconnect', undefined)
      // TODO: Reconnect
    })
    ws.on('error', handleError)
    return {
      addresses: [],
      codec,
      socketReady,
      ws
    }
  }

  function getAddressConnection(address: string): Connection | undefined {
    const connectionIndex = addressToConnectionIndex.get(address)
    if (connectionIndex == null) return
    return connections[connectionIndex]
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
    addressToConnectionIndex.set(address, connections.length - 1)
    return connection
  }

  function removeAddressConnection(address: string): Connection | undefined {
    const connectionIndex = addressToConnectionIndex.get(address)
    if (connectionIndex == null) return
    const connection: Connection = connections[connectionIndex]
    const addressIndex = connection.addresses.indexOf(address)
    connection.addresses.splice(addressIndex, 1)
    addressToConnectionIndex.delete(address)
    if (connection.addresses.length === 0) {
      connection.ws.close()
      // TODO: Splice the connection out of array and update the addressToConnectionIndex table
    }
    return connection
  }

  function handleError(error: unknown): void {
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

  return {
    pluginId,
    on,

    async subscribe(address) {
      const connection =
        getAddressConnection(address) ?? setAddressConnection(address)
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
      const connection = getAddressConnection(address)
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
}
