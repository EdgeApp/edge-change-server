import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { getAddressPrefix } from '../addressUtils'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { snooze } from '../snooze'
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
    const response = await fetchEtherscanV2(urls, params, logger)
    if ('error' in response) {
      logger.error({
        status: response.httpStatus,
        statusText: response.httpStatusText,
        responseText: response.responseText,
        t: 'scanAddress error'
      })
      return true
    }
    let transactionData: ReturnType<typeof asResult>
    try {
      transactionData = asResult(response.json)
    } catch (error) {
      logger.error({
        t: 'scanAddress etherscanV2 asResult cleaner error',
        address: getAddressPrefix(normalizedAddress),
        response: String(JSON.stringify(response.json))
      })
      throw error
    }
    if (transactionData.status === '1' && transactionData.result.length > 0) {
      logger({
        t: 'scanAddress etherscanV2 found normal transactions',
        address: getAddressPrefix(normalizedAddress),
        checkpoint: checkpoint,
        numTxs: transactionData.result.length
      })
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
    const tokenResponse = await fetchEtherscanV2(urls, tokenParams, logger)
    if ('error' in tokenResponse) {
      logger.error({
        status: tokenResponse.httpStatus,
        statusText: tokenResponse.httpStatusText,
        address: getAddressPrefix(normalizedAddress),
        t: 'scanAddress etherscanV2 tokenTx error'
      })
      return false
    }
    const tokenData = asResult(tokenResponse.json)
    if (tokenData.status === '1' && tokenData.result.length > 0) {
      logger({
        t: 'scanAddress etherscanV2 found token transactions',
        address: getAddressPrefix(normalizedAddress),
        checkpoint: checkpoint,
        numTxs: tokenData.result.length
      })
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
    const internalResponse = await fetchEtherscanV2(
      urls,
      internalParams,
      logger
    )
    if ('error' in internalResponse) {
      logger.error({
        status: internalResponse.httpStatus,
        statusText: internalResponse.httpStatusText,
        t: 'scanAddress etherscanV2 internalTx error'
      })
      return false
    }
    let internalData: ReturnType<typeof asResult>
    try {
      internalData = asResult(internalResponse.json)
    } catch (error) {
      logger.error({
        t: 'scanAddress etherscanV2 asResult cleaner error',
        address: getAddressPrefix(normalizedAddress),
        response: String(JSON.stringify(internalResponse.json))
      })
      throw error
    }
    if (internalData.status === '1' && internalData.result.length > 0) {
      logger({
        t: 'scanAddress etherscanV2 found internal transactions',
        address: getAddressPrefix(normalizedAddress),
        checkpoint: checkpoint,
        numTxs: internalData.result.length
      })
      return true
    }

    logger({
      t: 'scanAddress etherscanV2 found no transactions',
      address: getAddressPrefix(normalizedAddress),
      checkpoint: checkpoint
    })
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

const rateLimitStrings = [
  'Max calls per sec rate',
  'ETIMEDOUT',
  'RateLimitExceeded'
]
const maxRetries = 10
const retryDelay = 3000

let inRetry = false

async function fetchEtherscanV2(
  urls: string[],
  params: URLSearchParams,
  logger: Logger
): Promise<EtherscanResult> {
  let retries = 0
  let text: string = ''
  if (inRetry) {
    await snooze(retryDelay)
  }

  // Response can't actually be null but typescript can't tell
  let response: Response | null = null

  while (retries++ < maxRetries) {
    // Use a random API URL:
    const url = pickRandom(urls)
    const host = new URL(url).host
    const apiKeys = serverConfig.serviceKeys[host]
    if (apiKeys == null) {
      logger.warn({ host, t: 'No API key found' })
    }
    // Use a random API key:
    const apiKey = apiKeys == null ? undefined : pickRandom(apiKeys)
    if (apiKey != null) {
      params.set('apikey', apiKey)
    }

    response = await fetch(`${url}/v2/api?${params.toString()}`)
    text = await response.text().catch(() => '')
    if (response.status !== 200) {
      return {
        error: true,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseText: text
      }
    }

    if (rateLimitStrings.some(str => text.includes(str))) {
      logger.warn({
        f: 'fetchEtherscanV2',
        t: 'Rate limit exceeded, retrying...'
      })
      inRetry = true
      await snooze(retryDelay * retries)
      inRetry = false
      continue
    }
  }
  return {
    json: JSON.parse(text),
    httpStatus: response?.status ?? 0
  }
}
