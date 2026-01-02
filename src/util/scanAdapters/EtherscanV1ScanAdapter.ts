import { asArray, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { getAddressPrefix } from '../addressUtils'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { snooze } from '../snooze'
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
    const response = await fetchEtherscanV1(urls, params, logger)
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
        t: 'scanAddress etherscanV1 asResult cleaner error',
        response: String(JSON.stringify(response.json))
      })
      throw error
    }
    if (transactionData.status === '1' && transactionData.result.length > 0) {
      logger({
        t: 'scanAddress etherscanV1 found normal transactions',
        address: getAddressPrefix(normalizedAddress),
        checkpoint: checkpoint,
        numTxs: transactionData.result.length
      })
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
    const tokenResponse = await fetchEtherscanV1(urls, tokenParams, logger)
    if ('error' in tokenResponse) {
      logger.error({
        status: tokenResponse.httpStatus,
        statusText: tokenResponse.httpStatusText,
        address: getAddressPrefix(normalizedAddress),
        t: 'scanAddress etherscanV1 tokenTx error'
      })
      return false
    }
    let tokenData: ReturnType<typeof asResult>
    try {
      tokenData = asResult(tokenResponse.json)
    } catch (error) {
      logger.error({
        t: 'scanAddress etherscanV1 asResult cleaner error',
        address: getAddressPrefix(normalizedAddress),
        response: String(JSON.stringify(tokenResponse.json))
      })
      throw error
    }
    if (tokenData.status === '1' && tokenData.result.length > 0) {
      logger({
        t: 'scanAddress etherscanV1 found token transactions',
        address: getAddressPrefix(normalizedAddress),
        checkpoint: checkpoint,
        numTxs: tokenData.result.length
      })
      return true
    }
    logger({
      t: 'scanAddress etherscanV1 found no transactions',
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

async function fetchEtherscanV1(
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

    // Use a random API key:
    const apiKey = apiKeys == null ? undefined : pickRandom(apiKeys)
    if (apiKey != null) {
      params.set('apikey', apiKey)
    }

    response = await fetch(`${url}/api?${params.toString()}`)
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
        f: 'fetchEtherscanV1',
        t: 'Rate limit exceeded, retrying...',
        response: text
      })
      inRetry = true
      await snooze(retryDelay * retries)
      inRetry = false
      continue
    }

    // Success - exit the retry loop
    break
  }
  return {
    json: JSON.parse(text),
    httpStatus: response?.status ?? 0
  }
}
