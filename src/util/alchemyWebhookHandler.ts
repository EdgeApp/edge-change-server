import crypto from 'crypto'
import http from 'http'

import { serverConfig } from '../serverConfig'
import { Logger, makeLogger } from './logger'

/**
 * Activity event from Alchemy Address Activity webhook
 */
export interface AlchemyActivity {
  blockNum: string
  hash: string
  fromAddress: string
  toAddress: string
  value: number
  erc721TokenId: string | null
  erc1155Metadata: Array<{ tokenId: string; value: string }> | null
  asset: string
  category: 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155' | 'token'
  rawContract: {
    rawValue: string
    address: string
    decimals: number
  }
  typeTraceAddress: string | null
  log?: {
    address: string
    topics: string[]
    data: string
    blockNumber: string
    transactionHash: string
    transactionIndex: string
    blockHash: string
    logIndex: string
    removed: boolean
  }
}

/**
 * Webhook payload from Alchemy Address Activity webhook
 */
export interface AlchemyWebhookPayload {
  webhookId: string
  id: string
  createdAt: string
  type: 'ADDRESS_ACTIVITY'
  event: {
    network: string
    activity: AlchemyActivity[]
  }
}

export type WebhookActivityHandler = (
  network: string,
  activity: AlchemyActivity[]
) => void

export interface AlchemyWebhookHandler {
  /** Register a handler for a specific network */
  registerNetworkHandler: (
    network: string,
    handler: WebhookActivityHandler
  ) => void

  /** Unregister a handler for a specific network */
  unregisterNetworkHandler: (network: string) => void

  /** Start the HTTP server to receive webhooks */
  start: () => void

  /** Stop the HTTP server */
  stop: () => void
}

/**
 * Creates an HTTP server that receives Alchemy webhook callbacks,
 * validates signatures, and routes activity events to registered handlers.
 */
export function makeAlchemyWebhookHandler(): AlchemyWebhookHandler {
  const logger: Logger = makeLogger('alchemy-webhook')
  const networkHandlers = new Map<string, WebhookActivityHandler>()
  let server: http.Server | null = null

  /**
   * Validates the webhook signature using HMAC-SHA256
   */
  function validateSignature(rawBody: string, signature: string): boolean {
    const signingKey = serverConfig.alchemyWebhookSigningKey
    if (signingKey === '') {
      logger.error({ msg: 'Missing alchemyWebhookSigningKey in config' })
      return false
    }

    const hmac = crypto.createHmac('sha256', signingKey)
    hmac.update(rawBody, 'utf8')
    const expectedSignature = hmac.digest('hex')

    // Use timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    } catch {
      // Lengths don't match
      return false
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    // Only accept POST requests to /webhook
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method Not Allowed')
      return
    }

    const host = req.headers.host
    if (host == null) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing host')
      return
    }
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname !== '/webhook' && url.pathname !== '/webhook/alchemy') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }

    // Collect request body
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')

      // Validate signature
      const signature = req.headers['x-alchemy-signature']
      if (typeof signature !== 'string') {
        logger.warn({ msg: 'Missing X-Alchemy-Signature header' })
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Missing signature')
        return
      }

      if (!validateSignature(rawBody, signature)) {
        logger.warn({ msg: 'Invalid webhook signature' })
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Invalid signature')
        return
      }

      // Parse payload
      let payload: AlchemyWebhookPayload
      try {
        payload = JSON.parse(rawBody) as AlchemyWebhookPayload
      } catch (error) {
        logger.error({ err: error, msg: 'Failed to parse webhook payload' })
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid JSON')
        return
      }

      // Validate payload type
      if (payload.type !== 'ADDRESS_ACTIVITY') {
        logger.warn({ type: payload.type, msg: 'Unexpected webhook type' })
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
        return
      }

      // Route to network handler
      const network = payload.event.network
      const handler = networkHandlers.get(network)

      if (handler != null) {
        try {
          handler(network, payload.event.activity)
        } catch (error) {
          logger.error({ err: error, network, msg: 'Error in network handler' })
        }
      } else {
        logger.warn({ network, msg: 'No handler registered for network' })
      }

      // Always respond 200 to acknowledge receipt
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
    })

    req.on('error', (error: Error) => {
      logger.error({ err: error, msg: 'Request error' })
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    })
  }

  return {
    registerNetworkHandler(network: string, handler: WebhookActivityHandler) {
      networkHandlers.set(network, handler)
      logger.info({ network, msg: 'Registered webhook handler' })
    },

    unregisterNetworkHandler(network: string) {
      networkHandlers.delete(network)
      logger.info({ network, msg: 'Unregistered webhook handler' })
    },

    start() {
      if (server != null) {
        logger.warn({ msg: 'Webhook server already running' })
        return
      }

      const { webhookHost, webhookPort } = serverConfig
      server = http.createServer(handleRequest)
      server.listen(webhookPort, webhookHost)
      logger.info({
        host: webhookHost,
        port: webhookPort,
        msg: 'Webhook server listening'
      })
    },

    stop() {
      if (server != null) {
        server.close()
        server = null
        logger.info({ msg: 'Webhook server stopped' })
      }
    }
  }
}
