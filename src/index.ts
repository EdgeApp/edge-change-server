import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'

import { serverConfig } from './serverConfig'
import { makeLogger } from './util/logger'

const logger = makeLogger('master-process')

const aggregatorRegistry = new AggregatorRegistry()

async function main(): Promise<void> {
  if (cluster.isPrimary) manageServers()
  else {
    // Use dynamic import to avoid instantiating worker module state for primary process
    await import('./worker')
  }
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
  logger.info({ port: metricsPort }, 'metrics server listening')
}

main().catch(error => {
  logger.error({ err: error }, 'main error')
  process.exit(1)
})
