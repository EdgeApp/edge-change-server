import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'

import { serverConfig } from './serverConfig'
import { makeAlchemyNotifyApi } from './util/alchemyNotifyApi'
import { makeLogger } from './util/logger'
import { makeSigningKeyStore } from './util/signingKeyStore'
import { makeWebhookRegistry } from './util/webhookRegistry'
import { startWorker } from './worker'

const logger = makeLogger('master-process')

const aggregatorRegistry = new AggregatorRegistry()

function main(): void {
  if (cluster.isPrimary) {
    manageServers()
  } else {
    // Create services for this worker process
    const notifyApi = makeAlchemyNotifyApi()
    const signingKeyStore = makeSigningKeyStore({ notifyApi })
    const webhookRegistry = makeWebhookRegistry()

    startWorker({ notifyApi, signingKeyStore, webhookRegistry })
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

  // Relay webhook activity broadcasts between workers so every worker
  // can match incoming activity against its own subscribedAddresses map:
  cluster.on('message', (sender, message) => {
    if (
      message != null &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'webhook-activity'
    ) {
      for (const id in cluster.workers) {
        const worker = cluster.workers[id]
        if (worker != null && worker !== sender) {
          worker.send(message)
        }
      }
    }
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

main()
