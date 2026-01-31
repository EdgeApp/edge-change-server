import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'
import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { serverConfig } from './serverConfig'
import { makeLogger } from './util/logger'

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
    logger.info({ pid, code, signal, msg: 'worker died' })
    cluster.fork()
  })

  // Set up a Prometheus-compatible metrics server:
  const httpServer = http.createServer((req, res) => {
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
  httpServer.listen(metricsPort, metricsHost)
  logger.info({ port: metricsPort, msg: 'metrics server listening' })
}

async function server(): Promise<void> {
  const { allPlugins } = await import('./plugins/allPlugins')
  const { listenPort, listenHost } = serverConfig

  const wss = new WebSocket.Server({
    port: listenPort,
    host: listenHost
  })
  logger.info({ port: listenPort, msg: 'websocket server listening' })

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
    logger.info({ pid: process.pid, msg: 'shutting down' })

    // Stop accepting new connections
    wss.close(() => {
      logger.info({ pid: process.pid, msg: 'websocket server closed' })
    })

    // Close all existing client connections
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down')
    }

    // Clean up plugin resources (timers, WebSocket connections, etc.)
    hub.destroy()

    logger.info({ pid: process.pid, msg: 'cleanup complete' })
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(error => {
  logger.error({ err: error }, 'main error')
  process.exit(1)
})
