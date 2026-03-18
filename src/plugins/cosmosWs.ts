import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { makeLogger } from '../util/logger'

export interface CosmosWsOptions {
  pluginId: string
  wsUrl: string
}

const ADDRESS_ATTRIBUTE_KEYS = [
  'transfer.sender',
  'transfer.recipient',
  'message.sender',
  'coin_spent.spender',
  'coin_received.receiver'
]

const MIN_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

function buildWsUrl(url: string): string {
  // Convert https:// -> wss:// and http:// -> ws://
  let wsUrl = url
  if (wsUrl.startsWith('https://')) {
    wsUrl = 'wss://' + wsUrl.slice('https://'.length)
  } else if (wsUrl.startsWith('http://')) {
    wsUrl = 'ws://' + wsUrl.slice('http://'.length)
  }
  // Append /websocket if not already present
  if (!wsUrl.endsWith('/websocket')) {
    wsUrl = wsUrl + '/websocket'
  }
  return wsUrl
}

export function makeCosmosWs(opts: CosmosWsOptions): AddressPlugin {
  const { pluginId, wsUrl } = opts
  const resolvedUrl = buildWsUrl(wsUrl)

  const [on, emit] = makeEvents<PluginEvents>()
  const logger = makeLogger('cosmosWs', pluginId)

  // Subscribed addresses map: normalized -> original
  const subscribedAddresses = new Map<string, string>()

  let ws: WebSocket | null = null
  let destroyed = false
  let backoffMs = MIN_BACKOFF_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(): void {
    if (destroyed) return

    ws = new WebSocket(resolvedUrl)

    ws.on('open', () => {
      logger.info('connected')
      backoffMs = MIN_BACKOFF_MS

      // Subscribe to all Tx events
      const subscribeMsg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        id: 1,
        params: { query: "tm.event='Tx'" }
      })
      const activeWs = ws
      if (activeWs != null) {
        activeWs.send(subscribeMsg)
      }
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const raw =
        data instanceof Buffer
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : String(data)
      handleMessage(raw)
    })

    ws.on('close', () => {
      logger.warn('disconnected')
      handleDisconnect()
    })

    ws.on('error', (err: Error) => {
      logger.error({ err }, 'websocket error')
      // close event will follow
    })
  }

  function handleDisconnect(): void {
    ws = null

    // Emit subLost for all subscribed addresses
    if (subscribedAddresses.size > 0) {
      const addresses = Array.from(subscribedAddresses.values())
      emit('subLost', { addresses })
    }

    if (!destroyed) {
      scheduleReconnect()
    }
  }

  function scheduleReconnect(): void {
    if (destroyed) return
    const delay = backoffMs
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    logger.info({ delayMs: delay }, 'scheduling reconnect')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function handleMessage(raw: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      logger.warn({ raw }, 'failed to parse message')
      return
    }

    if (
      msg == null ||
      typeof msg !== 'object' ||
      !('result' in msg) ||
      msg.result == null ||
      typeof msg.result !== 'object'
    ) {
      return
    }

    const result = msg.result as Record<string, unknown>

    // Tendermint v0.35+ / CometBFT: events are on result.events as flat map
    // e.g. { "transfer.sender": ["cosmos1..."], "transfer.recipient": ["cosmos1..."] }
    const events = result.events
    if (
      events != null &&
      typeof events === 'object' &&
      !Array.isArray(events)
    ) {
      const eventsMap = events as Record<string, unknown>
      const matchedAddresses = new Set<string>()

      for (const key of ADDRESS_ATTRIBUTE_KEYS) {
        const vals = eventsMap[key]
        if (Array.isArray(vals)) {
          for (const val of vals) {
            if (typeof val === 'string') {
              const normalized = val.trim()
              if (subscribedAddresses.has(normalized)) {
                matchedAddresses.add(normalized)
              }
            }
          }
        }
      }

      for (const addr of matchedAddresses) {
        const original = subscribedAddresses.get(addr) ?? addr
        emit('update', { address: original })
      }
      return
    }

    // Tendermint v0.34: events are in result.data.value.TxResult.result.events[]
    if (
      'data' in result &&
      result.data != null &&
      typeof result.data === 'object'
    ) {
      const data = result.data as Record<string, unknown>
      if (
        'value' in data &&
        data.value != null &&
        typeof data.value === 'object'
      ) {
        const value = data.value as Record<string, unknown>
        if (
          'TxResult' in value &&
          value.TxResult != null &&
          typeof value.TxResult === 'object'
        ) {
          const txResult = value.TxResult as Record<string, unknown>
          if (
            'result' in txResult &&
            txResult.result != null &&
            typeof txResult.result === 'object'
          ) {
            const txResultInner = txResult.result as Record<string, unknown>
            if (Array.isArray(txResultInner.events)) {
              const matchedAddresses = new Set<string>()
              for (const event of txResultInner.events) {
                if (event == null || typeof event !== 'object') continue
                const ev = event as {
                  type?: string
                  attributes?: Array<{ key: string; value: string }>
                }
                if (!Array.isArray(ev.attributes)) continue
                const evType = ev.type ?? ''
                for (const attr of ev.attributes) {
                  if (attr == null) continue
                  const key = decodeBase64OrRaw(attr.key)
                  const val = decodeBase64OrRaw(attr.value)
                  const fullKey = evType !== '' ? `${evType}.${key}` : key
                  if (ADDRESS_ATTRIBUTE_KEYS.includes(fullKey)) {
                    const normalized = val.trim()
                    if (subscribedAddresses.has(normalized)) {
                      matchedAddresses.add(normalized)
                    }
                  }
                }
              }
              for (const addr of matchedAddresses) {
                const original = subscribedAddresses.get(addr) ?? addr
                emit('update', { address: original })
              }
            }
          }
        }
      }
    }
  }

  function decodeBase64OrRaw(val: string): string {
    try {
      const decoded = Buffer.from(val, 'base64').toString('utf8')
      // Only use decoded value if it looks like printable text
      if (/^[\x20-\x7E]+$/.test(decoded)) {
        return decoded
      }
    } catch {
      // fall through
    }
    return val
  }

  // Start connection
  connect()

  return {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalized = address.trim()
      if (subscribedAddresses.has(normalized)) return false
      subscribedAddresses.set(normalized, address)
      return true
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalized = address.trim()
      if (!subscribedAddresses.has(normalized)) return false
      subscribedAddresses.delete(normalized)
      return true
    },

    destroy(): void {
      destroyed = true
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws != null) {
        ws.removeAllListeners()
        ws.close()
        ws = null
      }
    }
  }
}
