import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../../types'
import { pickRandom } from '../pickRandom'
import { ScanAdapter } from './scanAdapterTypes'

export interface EtherscanV1ScanAdapterConfig {
  type: 'etherscan-v1'
  urls: string[]
}

export function makeEtherscanV1ScanAdapter(
  scanAdapterConfig: EtherscanV1ScanAdapterConfig,
  logger: Logger
): ScanAdapter {
  const { urls } = scanAdapterConfig
  return async (address, checkpoint) => {
    // Always assume address has changed if checkpoint is not provided:
    if (checkpoint == null) {
      return true
    }

    // Make sure address is normalized (lowercase):
    const normalizedAddress = address.toLowerCase()

    const params = new URLSearchParams({
      module: 'account',
      action: 'txlist',
      address: normalizedAddress,
      startblock: checkpoint,
      endblock: '999999999',
      sort: 'asc'
    })
    // Use a random API URL:
    const url = pickRandom(urls)
    const host = new URL(url).host
    const apiKeys = serverConfig.serviceKeys[host]
    if (apiKeys == null) {
      logger.warn('No API key found for', host)
    }
    // Use a random API key:
    const apiKey = apiKeys == null ? undefined : pickRandom(apiKeys)
    if (apiKey != null) {
      params.set('apikey', apiKey)
    }
    const response = await fetch(`${url}/api?${params.toString()}`)
    if (response.status !== 200) {
      logger.error('scanAddress error', response.status, response.statusText)
      return true
    }
    const dataRaw = await response.json()

    const data = asObject({
      status: asString,
      result: asArray(asUnknown)
    })(dataRaw)

    if (data.status === '1' && data.result.length > 0) {
      return true
    }

    return false
  }
}
