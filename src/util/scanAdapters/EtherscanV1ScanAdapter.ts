import { asArray, asJSON, asObject, asString, asUnknown } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { serviceKeysFromUrl } from '../serviceKeys'
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

    // Query 1 block higher than the client's checkpoint:
    const startblock = String(Number(checkpoint) + 1)

    const params = {
      module: 'account',
      action: 'txlist',
      address: normalizedAddress,
      startblock,
      endblock: '999999999',
      sort: 'asc'
    }
    const response = await fetchEtherscanV1(urls, params, logger)
    if (!response.success) {
      logger.warn(
        {
          httpStatus: response.httpStatus,
          httpStatusText: response.httpStatusText,
          responseText: response.responseText
        },
        'scanAddress etherscanV1 txlist error'
      )
      throw new Error(
        `scanAddress etherscanV1 error: ${response.httpStatus} ${response.httpStatusText}`
      )
    }
    if (response.data.status === '1' && response.data.result.length > 0) {
      return true
    }

    // If no normal transactions, check for token transactions:
    const tokenParams = {
      module: 'account',
      action: 'tokentx',
      address: normalizedAddress,
      startblock,
      endblock: '999999999',
      sort: 'asc'
    }
    const tokenResponse = await fetchEtherscanV1(urls, tokenParams, logger)
    if (!tokenResponse.success) {
      logger.warn(
        {
          httpStatus: tokenResponse.httpStatus,
          httpStatusText: tokenResponse.httpStatusText,
          responseText: tokenResponse.responseText
        },
        'scanAddress etherscanV1 tokenTx error'
      )
      throw new Error(
        `scanAddress etherscanV1 tokenTx error: ${tokenResponse.httpStatus} ${tokenResponse.httpStatusText}`
      )
    }
    if (
      tokenResponse.data.status === '1' &&
      tokenResponse.data.result.length > 0
    ) {
      return true
    }

    return false
  }
}

const asEtherscanV1Result = asJSON(
  asObject({
    status: asString,
    result: asArray(asUnknown)
  })
)

type EtherscanV1Result = ReturnType<typeof asEtherscanV1Result>

type EtherscanResponse =
  | {
      success: true
      data: EtherscanV1Result
      httpStatus: number
    }
  | {
      success: false
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
  params: Record<string, string>,
  logger: Logger
): Promise<EtherscanResponse> {
  let retries = 0
  if (inRetry) {
    await snooze(retryDelay)
  }

  while (retries++ < maxRetries) {
    // Use a random API URL:
    const url = pickRandom(urls)
    if (url == null) {
      throw new Error('No URLs for EtherscanV1ScanAdapter provided')
    }
    const searchParams = new URLSearchParams(params)

    // Use a random API key:
    const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, url)
    const apiKey = apiKeys == null ? undefined : pickRandom(apiKeys)
    if (apiKey != null) {
      searchParams.set('apikey', apiKey)
    }

    const response = await fetch(`${url}/api?${searchParams.toString()}`)
    const text = await response.text()
    if (response.status !== 200) {
      return {
        success: false,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseText: text
      }
    }

    if (rateLimitStrings.some(str => text.includes(str))) {
      logger.warn({
        func: 'fetchEtherscanV1',
        msg: 'Rate limit exceeded, retrying...',
        response: text
      })
      inRetry = true
      await snooze(retryDelay * retries)
      inRetry = false
      continue
    }

    // Parse and clean the response (let cleaner throw if invalid)
    const data = asEtherscanV1Result(text)

    return {
      success: true,
      data,
      httpStatus: response?.status ?? 0
    }
  }

  throw new Error('Failed to fetch EtherscanV1 data after max retries')
}
