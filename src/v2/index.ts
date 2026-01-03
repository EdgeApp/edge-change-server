// src/v2/index.ts
// Multi-process plugin architecture entry point

import cluster from 'cluster'
import http from 'http'
import { AggregatorRegistry } from 'prom-client'
import WebSocket from 'ws'

import { serverConfig } from '../serverConfig'
import { makeLogger } from '../util/logger'
import { makeAddressHub, makePluginCallbacks } from './hub'
import { runPluginWorker } from './plugin/pluginWorker'
import { makePluginManager } from './pluginManager'
import { blockbookPluginFactory } from './plugins/blockbook/blockbook'
import { evmrpcPluginFactory } from './plugins/evmRpc/evmRpc'

const DEBUG_UPDATE_ENABLED =
  process.env.DEBUG_UPDATE_ENABLED === 'true' ||
  process.argv.includes('--debug')

const logger = makeLogger('server')

const aggregatorRegistry = new AggregatorRegistry()

// Plugins to start (each defines its own name and chainPluginIds)
const plugins = [blockbookPluginFactory, evmrpcPluginFactory]

async function main(): Promise<void> {
  logger({ DEBUG_UPDATE_ENABLED })
  if (cluster.isPrimary) {
    // Primary process: spawn plugins and run WebSocket server
    await runPrimary()
  } else if (process.env.PLUGIN_NAME != null) {
    // Worker process: run the specified plugin
    await runPluginWorker()
  } else {
    // Unknown worker type
    logger.error({ t: 'Unknown worker type - no PLUGIN_NAME set' })
    process.exit(1)
  }
}

async function runPrimary(): Promise<void> {
  const { listenPort, listenHost, metricsHost, metricsPort } = serverConfig

  logger({ t: 'primary starting' })

  // Create a shared connections map that will be populated by the hub
  // and used by plugin callbacks for routing updates
  let hubConnections: Map<string, any> | null = null

  // Create callbacks that plugins will use to notify us of updates
  // These callbacks use the hubConnections map which gets set after hub creation
  const pluginCallbacks = makePluginCallbacks(() => hubConnections)

  // Start plugin manager (forks workers for each plugin)
  const pluginManager = makePluginManager(plugins, pluginCallbacks)
  await pluginManager.start()

  logger({ t: 'all plugins started', count: plugins.length })

  // Create the hub
  const hub = makeAddressHub({ pluginManager })

  // Wire up the connections map from the hub to the callbacks
  hubConnections = hub.getConnections()

  // Start WebSocket server
  const wss = new WebSocket.Server({
    port: listenPort,
    host: listenHost
  })
  logger({
    port: listenPort,
    host: listenHost,
    t: 'websocket server listening'
  })

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

  // Set up a Prometheus-compatible metrics server with debug endpoints
  const httpServer = http.createServer((req, res) => {
    const url = req.url ?? '/'

    // Debug endpoint to trigger a fake update
    if (DEBUG_UPDATE_ENABLED && url.startsWith('/debug/update')) {
      const params = new URL(url, 'http://localhost').searchParams
      const pluginId = params.get('pluginId') ?? 'ethereum'
      const address =
        params.get('address') ?? '0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9'

      logger({ t: 'DEBUG: triggering fake update via HTTP', pluginId, address })

      const plugin = pluginManager.getPluginForId(pluginId)
      if (plugin?.debugTriggerUpdate != null) {
        plugin
          .debugTriggerUpdate(pluginId, address)
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end(`Triggered update for ${pluginId}:${address}`)
          })
          .catch(error => {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end(`Error: ${String(error)}`)
          })
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end(`Plugin ${pluginId} not found or does not support debug`)
      }
      return
    }

    // Default: metrics
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
  logger({
    port: metricsPort,
    host: metricsHost,
    t: 'metrics server listening'
  })

  // Track plugin name per worker for restart
  const workerPluginNames = new Map<number, string>()

  // Track workers as they're forked by pluginManager
  cluster.on('fork', worker => {
    const pluginName = (worker as any).process?.env?.PLUGIN_NAME as
      | string
      | undefined
    if (pluginName != null && worker.id != null) {
      workerPluginNames.set(worker.id, pluginName)
    }
  })

  // Restart plugin workers if they die unexpectedly
  cluster.on('exit', (worker, code, signal) => {
    const pluginName = workerPluginNames.get(worker.id)
    const { pid: workerPid = '?' } = worker.process
    logger.error({
      workerPid,
      pluginName,
      code,
      signal,
      t: 'plugin worker died'
    })

    // Restart the plugin
    if (pluginName != null) {
      logger({ pluginName, t: 'restarting plugin worker' })
      workerPluginNames.delete(worker.id)
      const newWorker = cluster.fork({ PLUGIN_NAME: pluginName })
      workerPluginNames.set(newWorker.id, pluginName)
    }
  })

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    logger({ t: 'shutting down' })

    // Stop accepting new connections
    wss.close(() => {
      logger({ t: 'websocket server closed' })
    })

    // Close all existing client connections
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down')
    }

    // Clean up hub and plugin resources
    await hub.destroy()

    // Close metrics server
    httpServer.close()

    logger({ t: 'cleanup complete' })
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    shutdown().catch(err => {
      logger.error({ t: 'shutdown error', error: String(err) })
      process.exit(1)
    })
  })
  process.on('SIGINT', () => {
    shutdown().catch(err => {
      logger.error({ t: 'shutdown error', error: String(err) })
      process.exit(1)
    })
  })
}

main().catch(error => {
  logger.error({ t: 'fatal error', error: String(error) })
  process.exit(1)
})
