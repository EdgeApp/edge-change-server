import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'
import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { allPlugins } from './plugins/allPlugins'
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
  const { listenPort, listenHost } = serverConfig

  const server = new WebSocket.Server({
    port: listenPort,
    host: listenHost
  })
  console.log(`WebSocket server listening on port ${listenPort}`)

  const hub = makeAddressHub(allPlugins)
  server.on('connection', ws => hub.handleConnection(ws))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
