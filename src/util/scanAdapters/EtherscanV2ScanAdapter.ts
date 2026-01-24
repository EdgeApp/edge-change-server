import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { serviceKeysFromUrl } from '../serviceKeys'
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
    if (url == null) {
      logger.error('No URLs for EtherscanV2ScanAdapter provided')
      return false
    }
    const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, url)
    const apiKey = pickRandom(apiKeys)
    if (apiKey != null) {
      params.set('apikey', apiKey)
    } else {
      logger.warn({ url }, 'No API key found, proceeding without one')
    }
    const response = await fetchEtherscanV2(url, params)
    if ('error' in response) {
      logger.error(
        {
          status: response.httpStatus,
          statusText: response.httpStatusText,
          responseText: response.responseText
        },
        'scanAddress error'
      )
      return true
    }
    let transactionData: ReturnType<typeof asResult>
    try {
      transactionData = asResult(response.json)
    } catch (error) {
      logger.error(
        { err: error, response: String(JSON.stringify(response.json)) },
        'scanAddress asResult cleaner error'
      )
      throw error
    }
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
        {
          status: tokenResponse.httpStatus,
          statusText: tokenResponse.httpStatusText
        },
        'scanAddress tokenTx error'
      )
      return false
    }
    const tokenData = asResult(tokenResponse.json)
    if (tokenData.status === '1' && tokenData.result.length > 0) {
      return true
    }

    // If no normal transactions, check for internal transactions:
    const internalParams = new URLSearchParams({
      chainId: chainId.toString(),
      module: 'account',
      action: 'txlistinternal',
      address: normalizedAddress,
      startblock: checkpoint,
      endblock: '999999999',
      sort: 'asc'
    })
    if (apiKey != null) {
      internalParams.set('apikey', apiKey)
    }
    const internalResponse = await fetchEtherscanV2(url, internalParams)
    if ('error' in internalResponse) {
      logger.error(
        {
          status: internalResponse.httpStatus,
          statusText: internalResponse.httpStatusText
        },
        'scanAddress internalTx error'
      )
      return false
    }
    let internalData: ReturnType<typeof asResult>
    try {
      internalData = asResult(internalResponse.json)
    } catch (error) {
      logger.error(
        { err: error, response: String(JSON.stringify(internalResponse.json)) },
        'scanAddress asResult cleaner error'
      )
      throw error
    }
    if (internalData.status === '1' && internalData.result.length > 0) {
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
  | {
      error: boolean
      httpStatus: number
      httpStatusText: string
      responseText: string
    }

async function fetchEtherscanV2(
  url: string,
  params: URLSearchParams
): Promise<EtherscanResult> {
  const response = await fetch(`${url}/v2/api?${params.toString()}`)
  if (response.status !== 200) {
    const text = await response.text().catch(() => '')
    return {
      error: true,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      responseText: text
    }
  }

  const json = await response.json()
  return {
    json,
    httpStatus: response.status
  }
}
