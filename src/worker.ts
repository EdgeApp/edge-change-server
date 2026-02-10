import WebSocket from 'ws'

import { makeAddressHub } from './hub'
import { allPlugins } from './plugins/allPlugins'
import { serverConfig } from './serverConfig'
import { makeLogger } from './util/logger'

const logger = makeLogger('server')

const { listenPort, listenHost } = serverConfig

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

  logger.info({ pid: process.pid }, 'cleanup complete')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
