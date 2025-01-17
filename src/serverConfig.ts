import { makeConfig } from 'cleaner-config'
import { asNumber, asObject, asOptional, asString } from 'cleaners'
import { cpus } from 'os'

/**
 * Configures the server process as a whole,
 * such as where to listen and how to talk to the database.
 */
const asServerConfig = asObject({
  // Performance options:
  instanceCount: asOptional(asNumber, cpus().length),

  // HTTP server options:
  listenHost: asOptional(asString, '127.0.0.1'),
  listenPort: asOptional(asNumber, 8008),
  metricsHost: asOptional(asString, '127.0.0.1'),
  metricsPort: asOptional(asNumber, 8009),
  publicUri: asOptional(asString, 'https://address1.edge.app')
})

export const serverConfig = makeConfig(
  asServerConfig,
  './changeServerConfig.json'
)
