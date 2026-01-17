import { asArray, asObject, asString, Cleaner } from 'cleaners'

/**
 * The service keys map will map from a hostname to a list of API keys.
 *
 * For example, the service keys map might look like this:
 *
 * ```
 * {
 *   'api.example.com:443': ['key1', 'key2'],
 *   'api.example.com': ['key3', 'key4'],
 *   'example.com': ['key3', 'key4'],
 * }
 * ```
 * More specific hostnames will take precedence over less specific ones (e.g.
 * api.example.com:443 over api.example.com over example.com).
 */
export interface ServiceKeys {
  [domain: string]: string[]
}
export const asServiceKeys: Cleaner<ServiceKeys> = asObject(asArray(asString))

/**
 * Returns a service key for the given URL by matching the host (with or
 * without port) against the serviceKeys map. It checks subdomains as well.
 * For example, "https://api.example.com:443" will first look for a
 * key for "api.example.com:443", then "api.example.com", then
 * "example.com:433". Returns a random key from the matching list if found.
 */
export function serviceKeysFromUrl(
  serviceKeys: ServiceKeys,
  url: string
): string[] {
  const urlObj = new URL(url)
  const fullDomain = urlObj.hostname
  const domainParts = fullDomain.split('.')
  let apiKeys: string[] = []
  // Try matching at each domain level, from most specific (full) to least
  for (let i = 0; i <= domainParts.length - 2; i++) {
    const domain = domainParts.slice(i).join('.')
    const candidateWithPort =
      urlObj.port !== '' ? `${domain}:${urlObj.port}` : domain
    apiKeys = serviceKeys[candidateWithPort]
    if (apiKeys == null) {
      apiKeys = serviceKeys[domain]
    }
    if (apiKeys != null) {
      break
    }
  }
  if (apiKeys != null) {
    return apiKeys
  }
  return []
}
