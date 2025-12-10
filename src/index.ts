import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'
import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { serverConfig } from './serverConfig'

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
    console.log(`Worker ${pid} died with code ${code} and signal ${signal}`)
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
  console.log(`Metrics server listening on port ${metricsPort}`)
}

async function server(): Promise<void> {
  const { allPlugins } = await import('./plugins/allPlugins')
  const { listenPort, listenHost } = serverConfig

  const wss = new WebSocket.Server({
    port: listenPort,
    host: listenHost
  })
  console.log(`WebSocket server listening on port ${listenPort}`)

  const hub = makeAddressHub({ plugins: allPlugins, logger: console })
  wss.on('connection', ws => hub.handleConnection(ws))

  // Graceful shutdown handler
  const shutdown = (): void => {
    console.log(`Worker ${process.pid} shutting down...`)

    // Stop accepting new connections
    wss.close(() => {
      console.log(`Worker ${process.pid} WebSocket server closed`)
    })

    // Close all existing client connections
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down')
    }

    // Clean up plugin resources (timers, WebSocket connections, etc.)
    hub.destroy()

    console.log(`Worker ${process.pid} cleanup complete`)
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
