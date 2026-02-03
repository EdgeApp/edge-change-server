import { makeConfig } from 'cleaner-config'
import { asNumber, asObject, asOptional, asString } from 'cleaners'
import { cpus } from 'os'

import { asServiceKeys } from './util/serviceKeys'

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
  webhookHost: asOptional(asString, '127.0.0.1'),
  webhookPort: asOptional(asNumber, 8010),
  publicUri: asOptional(asString, 'https://address1.edge.app'),

  // Alchemy webhook:
  alchemyAuthToken: asOptional(asString, ''),

  // Resources:
  serviceKeys: asOptional(asServiceKeys, () => ({
    '<service-host>': ['<api-key>']
  }))
})

export const serverConfig = makeConfig(
  asServerConfig,
  './changeServerConfig.json'
)
