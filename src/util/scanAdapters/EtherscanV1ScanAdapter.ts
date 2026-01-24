import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { serviceKeysFromUrl } from '../serviceKeys'
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
    if (url == null) {
      logger.error('No URLs for EtherscanV1ScanAdapter provided')
      return true
    }
    const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, url)
    const apiKey = pickRandom(apiKeys)
    if (apiKey != null) {
      params.set('apikey', apiKey)
    } else {
      logger.warn({ url }, 'No API key found, proceeding without one')
    }
    const response = await fetch(`${url}/api?${params.toString()}`)
    if (response.status !== 200) {
      const text = await response.text().catch(() => '')
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          responseText: text
        },
        'scanAddress error'
      )
      return true
    }
    const dataRaw = await response.json()
    const data = asResult(dataRaw)
    if (data.status === '1' && data.result.length > 0) {
      return true
    }

    // If no normal transactions, check for token transactions:
    const tokenParams = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      address: normalizedAddress,
      startblock: checkpoint,
      endblock: '999999999',
      sort: 'asc'
    })
    if (apiKey != null) {
      tokenParams.set('apikey', apiKey)
    }
    const tokenResponse = await fetch(`${url}/api?${tokenParams.toString()}`)
    if (tokenResponse.status !== 200) {
      logger.error(
        {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText
        },
        'scanAddress tokenTx error'
      )
      return false
    }
    const tokenDataRaw = await tokenResponse.json()
    const tokenData = asResult(tokenDataRaw)
    if (tokenData.status === '1' && tokenData.result.length > 0) {
      return true
    }

    return false
  }
}

const asResult = asObject({
  status: asString,
  result: asArray(asUnknown)
})
