import { asArray, asJSON, asNumber, asObject, asString } from 'cleaners'

import { serverConfig } from '../../serverConfig'
import { Logger } from '../logger'
import { pickRandom } from '../pickRandom'
import { serviceKeysFromUrl } from '../serviceKeys'
import { snooze } from '../snooze'
import { ScanAdapter } from './scanAdapterTypes'

export interface TatumScanAdapterConfig {
  type: 'tatum'
  chain: string
}

const TATUM_API_URL = 'https://api.tatum.io'

export function makeTatumScanAdapter(
  scanAdapterConfig: TatumScanAdapterConfig,
  logger: Logger
): ScanAdapter {
  const { chain } = scanAdapterConfig
  return async (address, checkpoint) => {
    if (checkpoint == null) {
      return true
    }

    const normalizedAddress = address.toLowerCase()
    const fromBlock = Number(checkpoint) + 1

    const params = new URLSearchParams({
      chain,
      addresses: normalizedAddress,
      fromBlock: fromBlock.toString(),
      pageSize: '1'
    })

    const response = await fetchTatum(
      `${TATUM_API_URL}/v4/data/transactions?${params.toString()}`,
      logger
    )

    return response.result.length > 0
  }
}

const asTatumTransactionsResponse = asJSON(
  asObject({
    result: asArray(
      asObject({
        blockNumber: asNumber,
        hash: asString
      })
    ),
    prevPage: asString,
    nextPage: asString
  })
)

type TatumTransactionsResponse = ReturnType<typeof asTatumTransactionsResponse>

const maxRetries = 5
const retryDelay = 3000

async function fetchTatum(
  url: string,
  logger: Logger
): Promise<TatumTransactionsResponse> {
  let retries = 0

  while (retries++ < maxRetries) {
    const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, TATUM_API_URL)
    const apiKey = apiKeys.length > 0 ? pickRandom(apiKeys) : undefined

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey != null) {
      headers['x-api-key'] = apiKey
    }

    const response = await fetch(url, { headers })
    const text = await response.text()

    if (response.status === 429) {
      logger.warn(
        { func: 'fetchTatum', status: response.status },
        'Rate limit exceeded, retrying...'
      )
      await snooze(retryDelay * retries)
      continue
    }

    if (response.status !== 200) {
      throw new Error(
        `Tatum API error: ${response.status} ${response.statusText}`
      )
    }

    return asTatumTransactionsResponse(text)
  }

  throw new Error('Failed to fetch Tatum data after max retries')
}
