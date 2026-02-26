import express, { Express } from 'express'
import http from 'http'
import { pickMethod, pickPath } from 'serverlet'
import { ExpressRequest, makeExpressRoute } from 'serverlet/express'
import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { withWebhookRegistry } from './middleware/withWebhookRegistry'
import { makeAllPlugins } from './plugins/allPlugins'
import { healthCheckRoute } from './routes/healthCheckRoute'
import { notFoundRoute } from './routes/notFoundRoute'
import { webhookRoute } from './routes/webhookRoute'
import { serverConfig } from './serverConfig'
import { AlchemyNotifyApi } from './util/alchemyNotifyApi'
import { logger } from './util/logger'
import { SigningKeyStore } from './util/signingKeyStore'
import { WebhookRegistry } from './util/webhookRegistry'

export interface StartWorkerOptions {
  notifyApi: AlchemyNotifyApi
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
}

export function startWorker(opts: StartWorkerOptions): void {
  const { webhookRegistry } = opts

  const { listenPort, listenHost } = serverConfig

  // Main serverlet - routes to webhook endpoints
  const serverlet = pickPath<ExpressRequest>(
    {
      '/webhook/.+': pickMethod({
        GET: healthCheckRoute,
        HEAD: healthCheckRoute,
        POST: withWebhookRegistry({ webhookRegistry })(webhookRoute)
      })
    },
    notFoundRoute
  )

  // Create Express app
  const app: Express = express()
  // Use raw body parser to get the raw string for signature validation
  app.use(express.text({ type: '*/*' }))
  app.get('/', (_req, res) => {
    res.status(426).type('text/plain').send('Upgrade Required')
  })
  // Mount the serverlet
  app.use(makeExpressRoute(serverlet))

  const server = http.createServer(app)
  const wss = new WebSocket.Server({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '/'
    if (url.startsWith('/webhook')) {
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req)
    })
  })

  server.listen(listenPort, listenHost, () => {
    logger.info(
      {
        host: listenHost,
        port: listenPort
      },
      'HTTP + websocket server listening'
    )
  })

  const allPlugins = makeAllPlugins(opts)
  const hub = makeAddressHub({ plugins: allPlugins })
  wss.on('connection', (ws, req) => {
    // Extract IP from X-Forwarded-For header (if behind proxy) or socket
    const forwardedFor = req.headers['x-forwarded-for']
    const ip =
      (typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : undefined) ??
      req.socket.remoteAddress ??
      'unknown'
    hub.handleConnection(ws, ip)
  })

  // Graceful shutdown handler
  const shutdown = (): void => {
    logger.info({ pid: process.pid }, 'shutting down')

    // Stop accepting new connections
    wss.close(() => {
      logger.info({ pid: process.pid }, 'websocket server closed')
    })

    // Close all existing client connections
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down')
    }

    // Clean up plugin resources (timers, WebSocket connections, etc.)
    hub.destroy()

    server.close()
    logger.info('HTTP + websocket server stopped')

    logger.info({ pid: process.pid }, 'cleanup complete')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
