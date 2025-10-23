import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../../types'
import { pickRandom } from '../pickRandom'
import { ScanAdapter } from './scanAdapterTypes'

export interface EtherscanV2ScanAdapterConfig {
  type: 'etherscan-v2'
  chainId: number
  urls: string[]
}

export function makeEtherscanV2ScanAdapter(
  scanAdapterConfig: EtherscanV2ScanAdapterConfig,
  logger: Logger
): ScanAdapter {
  const { chainId, urls } = scanAdapterConfig
  return async (address, checkpoint) => {
    // Always assume address has changed if checkpoint is not provided:
    if (checkpoint == null) {
      return true
    }

    // Make sure address is normalized (lowercase):
    const normalizedAddress = address.toLowerCase()

    const params = new URLSearchParams({
      chainId: chainId.toString(),
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
    const response = await fetchEtherscanV2(url, params)
    if ('error' in response) {
      logger.error(
        'scanAddress error',
        response.httpStatus,
        response.httpStatusText
      )
      return true
    }
    const transactionData = asResult(response.json)
    if (transactionData.status === '1' && transactionData.result.length > 0) {
      return true
    }

    // If no normal transactions, check for token transactions:
    const tokenParams = new URLSearchParams({
      chainId: chainId.toString(),
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
    const tokenResponse = await fetchEtherscanV2(url, tokenParams)
    if ('error' in tokenResponse) {
      logger.error(
        'scanAddress tokenTx error',
        tokenResponse.httpStatus,
        tokenResponse.httpStatusText
      )
      return false
    }
    const tokenData = asResult(tokenResponse.json)
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

type EtherscanResult =
  | {
      json: unknown
      httpStatus: number
    }
  | { error: boolean; httpStatus: number; httpStatusText: string }

async function fetchEtherscanV2(
  url: string,
  params: URLSearchParams
): Promise<EtherscanResult> {
  const response = await fetch(`${url}/v2/api?${params.toString()}`)
  if (response.status !== 200) {
    return {
      error: true,
      httpStatus: response.status,
      httpStatusText: response.statusText
    }
  }

  const json = await response.json()
  return {
    json,
    httpStatus: response.status
  }
}
