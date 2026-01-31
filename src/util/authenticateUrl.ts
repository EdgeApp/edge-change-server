import { serverConfig } from '../serverConfig'
import { pickRandom } from './pickRandom'
import { replaceUrlParams } from './replaceUrlParams'
import { serviceKeysFromUrl } from './serviceKeys'

export function authenticateUrl(
  url: string,
  keyName: string = 'apiKey'
): string {
  const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, url)
  const apiKey = pickRandom(apiKeys) ?? ''
  const authenticatedUrl = replaceUrlParams(url, { [keyName]: apiKey })
  return authenticatedUrl
}
