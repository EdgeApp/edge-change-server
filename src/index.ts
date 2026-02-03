import cluster from 'cluster'
import express, { Express } from 'express'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'
import { pickMethod, pickPath } from 'serverlet'
import { ExpressRequest, makeExpressRoute } from 'serverlet/express'
import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { withWebhookRegistry } from './middleware/withWebhookRegistry'
import { alchemyWebhookRoute } from './routes/alchemyWebhookRoute'
import { notFoundRoute } from './routes/notFoundRoute'
import { serverConfig } from './serverConfig'
import { makeLogger } from './util/logger'
import { makeWebhookRegistry } from './util/webhookRegistry'

const logger = makeLogger('server')

const aggregatorRegistry = new AggregatorRegistry()

async function main(): Promise<void> {
  if (cluster.isPrimary) manageServers()
  else await server()
}

function manageServers(): void {
  const { instanceCount, metricsHost, metricsPort } = serverConfig

  // Spin up children:
  for (let i = 0; i < instanceCount; ++i) {
    cluster.fork()
  }

  // Restart workers when they exit:
  cluster.on('exit', (worker, code, signal) => {
    const { pid = '?' } = worker.process
    logger.info({ pid, code, signal }, 'worker died')
    cluster.fork()
  })

  // Set up a Prometheus-compatible metrics server:
  const metricsServer = http.createServer((req, res) => {
    aggregatorRegistry
      .clusterMetrics()
      .then(metrics => {
        res.writeHead(200, {
          'Content-Type': aggregatorRegistry.contentType
        })
        res.end(metrics)
      })
      .catch(error => {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(`Could not generate metrics: ${String(error)}`)
      })
  })
  metricsServer.listen(metricsPort, metricsHost)
  logger.info({ port: metricsPort }, 'metrics server listening')
}

async function server(): Promise<void> {
  const { makeAllPlugins } = await import('./plugins/allPlugins')
  const { listenPort, listenHost } = serverConfig

  // Create the webhook registry for plugins to register handlers
  const webhookRegistry = makeWebhookRegistry()

  // Main serverlet - routes to webhook endpoints
  const serverlet = pickPath<ExpressRequest>(
    {
      '/webhook/alchemy': pickMethod({
        POST: withWebhookRegistry(webhookRegistry)(alchemyWebhookRoute)
      })
    },
    notFoundRoute
  )

  // Create Express app
  const app: Express = express()
  // Use raw body parser to get the raw string for signature validation
  app.use(express.text({ type: '*/*' }))
  // Mount the serverlet
  app.use(makeExpressRoute(serverlet))

  const { webhookHost, webhookPort } = serverConfig
  const webhookServer = app.listen(webhookPort, webhookHost, () => {
    logger.info(
      {
        host: webhookHost,
        port: webhookPort
      },
      'HTTP server listening'
    )
  })

  // Create all plugins, passing the webhook registry
  const allPlugins = makeAllPlugins(webhookRegistry)

  const wss = new WebSocket.Server({
    port: listenPort,
    host: listenHost
  })
  logger.info({ port: listenPort }, 'websocket server listening')

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

    webhookServer.close()
    logger.info('HTTP server stopped')

    logger.info({ pid: process.pid }, 'cleanup complete')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(error => {
  logger.error({ err: error }, 'main error')
  process.exit(1)
})
