import { makeConfig } from 'cleaner-config'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
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

  // Resources:
  nowNodesApiKey: asOptional(asString, ''),
  // URL parameter replacements: { paramName: 'apiKeyValue' }
  // Usage in URLs: 'https://example.com/{{paramName}}/rpc'
  serviceKeyUrlParams: asOptional(asObject(asString)),
  serviceKeys: asOptional(
    asObject<string[] | undefined>(asArray(asString)),
    () => ({
      '<service-host>': ['<api-key>']
    })
  )
})

export const serverConfig = makeConfig(
  asServerConfig,
  './changeServerConfig.json'
)

/**
 * Replaces {{paramName}} placeholders in a URL with values from serviceKeyUrlParams.
 * Returns the URL unchanged if no placeholders are found or no matching param exists.
 */
export function replaceUrlParams(url: string): string {
  const params = serverConfig.serviceKeyUrlParams ?? {}
  let result = url
  for (const [paramName, value] of Object.entries(params)) {
    result = result.replace(`{{${paramName}}}`, value)
  }
  return result
}
