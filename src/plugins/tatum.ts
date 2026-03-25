/**
 * Tatum Address Activity webhook plugin.
 *
 * ## How it works
 * 1. On `subscribe(address)`, creates a Tatum ADDRESS_EVENT subscription that
 *    POSTs to `/webhook/tatum/<pluginId>` whenever the address has activity.
 * 2. On `unsubscribe(address)`, deletes the Tatum subscription.
 * 3. Incoming webhooks are verified via HMAC-SHA256 and processed idempotently.
 *
 * ## Webhook verification
 * When `serverConfig.tatumHmacSecret` is set:
 *   - The secret is included in each subscription `attr.hmacSecret` so Tatum
 *     signs every delivery.
 *   - Each inbound request must carry `X-Tatum-Signature`, computed as
 *     `HMAC-SHA256(rawBody, tatumHmacSecret)` (hex).
 *   - Requests with a missing or invalid signature are rejected with HTTP 401.
 *   - When no secret is configured verification is skipped (dev/test mode).
 *
 * ## Idempotency
 * Tatum delivers webhooks with at-least-once semantics. The composite key
 * `txId:address` is used for idempotency so that the same transaction
 * correctly triggers updates for every subscribed address it touches while
 * still deduplicating retries. Already-seen keys are tracked in a bounded
 * LRU-like Set (`processedKeys`). Duplicate deliveries return HTTP 200
 * immediately without re-emitting the update event. The set is capped at
 * `MAX_PROCESSED_IDS` entries to bound memory usage.
 *
 * ## Retry / backoff for subscription API calls
 * Calls to `createSubscription` and `deleteSubscription` retry on transient
 * failures (network errors, HTTP 5xx) with exponential backoff:
 *   attempt 1 → 1 s delay
 *   attempt 2 → 2 s delay
 *   attempt 3 → 4 s delay
 *   attempt 4 → 8 s delay
 *   attempt 5 → 16 s delay  (then throws)
 */

import {
  asArray,
  asJSON,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import crypto from 'crypto'
import { makeEvents } from 'yavent'

import { serverConfig } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { makeLogger } from '../util/logger'
import { pickRandom } from '../util/pickRandom'
import { serviceKeysFromUrl } from '../util/serviceKeys'
import { snooze } from '../util/snooze'
import { WebhookRegistry, WebhookRoute } from '../util/webhookRegistry'

const TATUM_API_URL = 'https://api.tatum.io'

/**
 * Mapping from Edge plugin IDs to Tatum blockchain chain identifiers.
 *
 * Chain identifiers follow Tatum's naming convention (e.g. bitcoin-mainnet).
 * Used when creating ADDRESS_EVENT subscriptions via the Tatum v4 API.
 *
 * Reference: https://docs.tatum.io/reference/notifications-supported-chains
 *
 * Tatum plugins covered (7 total):
 *  - bitcoin         -> bitcoin-mainnet
 *  - bitcoincash     -> bch-mainnet
 *  - dogecoin        -> doge-mainnet
 *  - litecoin        -> litecoin-core-mainnet
 *  - ripple          -> ripple-mainnet   (XRP)
 *  - tezos           -> tezos-mainnet
 *  - tron            -> tron-mainnet
 */
export const tatumChainMap: Readonly<Record<string, string>> = {
  bitcoin: 'bitcoin-mainnet',
  bitcoincash: 'bch-mainnet',
  dogecoin: 'doge-mainnet',
  litecoin: 'litecoin-core-mainnet',
  ripple: 'ripple-mainnet',
  tezos: 'tezos-mainnet',
  tron: 'tron-mainnet'
}

/** Max retries for outbound Tatum API calls (subscription create/delete). */
const MAX_API_RETRIES = 5

/** Initial backoff delay (ms) for API retries; doubles on each attempt. */
const INITIAL_RETRY_DELAY_MS = 1000

/**
 * Max number of processed txIds to keep in the idempotency set.
 * Oldest entries are evicted when the set exceeds this size.
 */
const MAX_PROCESSED_IDS = 10_000
const SUBSCRIPTION_PAGE_SIZE = 50
const TATUM_TRANSACTION_SCAN_CHAINS = new Set<string>([
  'bsc-mainnet',
  'bsc-testnet',
  'celo-mainnet',
  'celo-testnet',
  'chiliz-mainnet',
  'ethereum-mainnet',
  'ethereum-holesky',
  'ethereum-sepolia',
  'mocachain-devnet',
  'polygon-mainnet',
  'polygon-amoy',
  'tezos-mainnet'
])

// Module-level cached promise (shared across all makeTatum instances).
// Reset to undefined on failure so retries can create a fresh promise.
let allSubscriptionsPromise: Promise<TatumSubscriptionInfo[]> | undefined

export interface TatumOptions {
  pluginId: string
  chain: string
  webhookRegistry: WebhookRegistry
  /** Normalize addresses for comparisons. Defaults to identity. */
  normalizeAddress?: (address: string) => string
}

export function makeTatum(opts: TatumOptions): AddressPlugin {
  const {
    pluginId,
    chain,
    webhookRegistry,
    normalizeAddress = addr => addr
  } = opts

  const WEBHOOK_KEY = `tatum/${pluginId}`
  const EXPECTED_WEBHOOK_URL = `${serverConfig.publicUri}/webhook/${WEBHOOK_KEY}`

  const [on, emit] = makeEvents<PluginEvents>()

  const logger = makeLogger('tatum', pluginId)

  // address (normalized) → Tatum subscriptionId
  const subscriptions = new Map<string, string>()

  // Idempotency: set of already-processed keys (txId:address).
  // When MAX_PROCESSED_IDS is reached the oldest half is dropped.
  const processedKeys = new Set<string>()

  // Whether we've initialized (discovered existing subscriptions).
  let initialized = false
  let initializingPromise: Promise<void> | null = null

  function getApiKey(): string | undefined {
    const apiKeys = serviceKeysFromUrl(serverConfig.serviceKeys, TATUM_API_URL)
    return apiKeys.length > 0 ? pickRandom(apiKeys) : undefined
  }

  function makeHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    const apiKey = getApiKey()
    if (apiKey != null) {
      headers['x-api-key'] = apiKey
    }
    return headers
  }

  /**
   * Whether a subscription's webhook URL belongs to this server instance
   * and this specific plugin. Guards against cross-server subscription
   * takeover when multiple deployments share the same Tatum API key.
   *
   * Uses prefix + suffix matching rather than exact equality against
   * EXPECTED_WEBHOOK_URL so that doInitialize can discover and migrate
   * stale subscriptions whose path structure changed between deployments.
   */
  function isOwnedWebhookUrl(url: string): boolean {
    return (
      url.startsWith(serverConfig.publicUri + '/') &&
      url.endsWith(`/webhook/${WEBHOOK_KEY}`)
    )
  }

  function canonicalChain(chainId: string): string {
    const normalized = chainId.toLowerCase()
    const aliasMap: Record<string, string> = {
      'bitcoin-mainnet': 'btc',
      btc: 'btc',
      'bch-mainnet': 'bch',
      bch: 'bch',
      'doge-mainnet': 'doge',
      doge: 'doge',
      'litecoin-core-mainnet': 'ltc',
      ltc: 'ltc',
      'ripple-mainnet': 'xrp',
      xrp: 'xrp',
      'tezos-mainnet': 'tezos',
      tezos: 'tezos',
      'tron-mainnet': 'tron',
      tron: 'tron'
    }
    return aliasMap[normalized] ?? normalized
  }

  function matchesConfiguredChain(subscriptionChain: string): boolean {
    return canonicalChain(subscriptionChain) === canonicalChain(chain)
  }

  async function listAllSubscriptions(): Promise<TatumSubscriptionInfo[]> {
    if (allSubscriptionsPromise == null) {
      allSubscriptionsPromise = (async () => {
        const results: TatumSubscriptionInfo[] = []
        let offset = 0

        while (true) {
          const params = new URLSearchParams({
            pageSize: SUBSCRIPTION_PAGE_SIZE.toString(),
            offset: offset.toString()
          })
          const response = await fetch(
            `${TATUM_API_URL}/v4/subscription?${params.toString()}`,
            {
              headers: makeHeaders()
            }
          )

          if (!response.ok) {
            const text = await response.text()
            throw new Error(
              `Tatum listSubscriptions error: ${response.status} ${response.statusText} - ${text}`
            )
          }

          const page = asTatumSubscriptionsResponse(await response.text())
          results.push(...page)

          if (page.length < SUBSCRIPTION_PAGE_SIZE) break
          offset += SUBSCRIPTION_PAGE_SIZE
        }

        return results
      })()
    }

    try {
      return await allSubscriptionsPromise
    } catch (err) {
      allSubscriptionsPromise = undefined
      throw err
    }
  }

  async function updateSubscriptionUrl(
    subscriptionId: string,
    webhookUrl: string
  ): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        await snooze(delayMs)
      }

      try {
        const response = await fetch(
          `${TATUM_API_URL}/v4/subscription/${subscriptionId}`,
          {
            method: 'PUT',
            headers: makeHeaders(),
            body: JSON.stringify({ url: webhookUrl })
          }
        )

        if (response.ok) return

        const text = await response.text()
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(
            `Tatum updateSubscriptionUrl HTTP ${response.status}: ${text}`
          )
          continue
        }

        throw new Error(
          `Tatum updateSubscriptionUrl error: ${response.status} ${response.statusText} - ${text}`
        )
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('Tatum')) {
          throw err // Non-retryable errors propagate immediately
        }
        lastError = err
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error('updateSubscriptionUrl failed after max retries')
  }

  async function lookupSubscriptionByAddress(
    address: string
  ): Promise<TatumSubscriptionInfo | undefined> {
    let offset = 0

    while (true) {
      const params = new URLSearchParams({
        pageSize: SUBSCRIPTION_PAGE_SIZE.toString(),
        offset: offset.toString(),
        address
      })

      const response = await fetch(
        `${TATUM_API_URL}/v4/subscription?${params.toString()}`,
        {
          headers: makeHeaders()
        }
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Tatum lookupSubscriptionByAddress error: ${response.status} ${response.statusText} - ${text}`
        )
      }

      const page = asTatumSubscriptionsResponse(await response.text())
      const match = page.find(
        item =>
          item.type === 'ADDRESS_EVENT' &&
          matchesConfiguredChain(item.attr.chain) &&
          normalizeAddress(item.attr.address) === normalizeAddress(address)
      )
      if (match != null) return match

      if (page.length < SUBSCRIPTION_PAGE_SIZE) return undefined
      offset += SUBSCRIPTION_PAGE_SIZE
    }
  }

  async function initialize(): Promise<void> {
    if (initialized) return
    if (initializingPromise != null) return await initializingPromise

    initializingPromise = doInitialize()
    try {
      await initializingPromise
    } finally {
      initializingPromise = null
    }
  }

  async function doInitialize(): Promise<void> {
    logger.info({ msg: 'Discovering existing subscriptions' })
    const all = await listAllSubscriptions()
    let discoveredCount = 0

    for (const sub of all) {
      if (
        sub.type !== 'ADDRESS_EVENT' ||
        !matchesConfiguredChain(sub.attr.chain)
      )
        continue
      if (!isOwnedWebhookUrl(sub.attr.url)) continue

      const normalizedAddress = normalizeAddress(sub.attr.address)
      if (sub.attr.url !== EXPECTED_WEBHOOK_URL) {
        logger.info(
          {
            address: normalizedAddress,
            subscriptionId: sub.id,
            oldUrl: sub.attr.url,
            newUrl: EXPECTED_WEBHOOK_URL
          },
          'Updating subscription URL'
        )
        await updateSubscriptionUrl(sub.id, EXPECTED_WEBHOOK_URL)
      }

      subscriptions.set(normalizedAddress, sub.id)
      discoveredCount += 1
    }

    initialized = true
    logger.info({ discoveredCount }, 'Subscription discovery complete')
  }

  /**
   * Record an idempotency key as processed, evicting the oldest half of
   * entries when the set reaches MAX_PROCESSED_IDS to keep memory bounded.
   */
  function markProcessed(key: string): void {
    if (processedKeys.size >= MAX_PROCESSED_IDS) {
      // Evict oldest half (Set iteration preserves insertion order)
      const evictCount = Math.floor(MAX_PROCESSED_IDS / 2)
      let i = 0
      for (const id of processedKeys) {
        if (i++ >= evictCount) break
        processedKeys.delete(id)
      }
    }
    processedKeys.add(key)
  }

  /**
   * Verify the HMAC-SHA256 signature from Tatum.
   *
   * Tatum computes: HMAC-SHA256(rawBody, hmacSecret) and sends the hex
   * digest in the `X-Tatum-Signature` request header.
   *
   * Returns true when verification passes or when no secret is configured
   * (permissive dev-mode).
   */
  function verifySignature(rawBody: string, signature: string): boolean {
    const secret = serverConfig.tatumHmacSecret
    if (secret == null || secret === '') {
      // No secret configured — skip verification (dev/test mode)
      return true
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex')

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    } catch {
      // Buffer lengths differ — signature is invalid
      return false
    }
  }

  /**
   * Create a Tatum ADDRESS_EVENT subscription for the given address.
   * Retries on transient failures with exponential backoff.
   *
   * Backoff schedule (ms): 1000, 2000, 4000, 8000, 16000
   */
  async function createSubscription(address: string): Promise<string> {
    const body: Record<string, unknown> = {
      type: 'ADDRESS_EVENT',
      attr: {
        chain,
        address,
        url: EXPECTED_WEBHOOK_URL
      }
    }

    // Include HMAC secret in subscription so Tatum signs deliveries
    const secret = serverConfig.tatumHmacSecret
    if (secret != null && secret !== '') {
      ;(body.attr as Record<string, unknown>).hmacSecret = secret
    }

    let lastError: unknown
    for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        logger.warn(
          { attempt, delayMs, address },
          'Retrying createSubscription'
        )
        await snooze(delayMs)
      }

      try {
        const response = await fetch(`${TATUM_API_URL}/v4/subscription`, {
          method: 'POST',
          headers: makeHeaders(),
          body: JSON.stringify(body)
        })

        if (response.status === 429) {
          // Rate-limited — always retry
          lastError = new Error(`Tatum rate limit (429) on attempt ${attempt}`)
          continue
        }

        if (!response.ok) {
          const text = await response.text()
          if (response.status === 403) {
            const errData = parseTatumErrorBody(text)
            if (
              errData?.errorCode ===
              'subscription.exists.on.address-and-currency'
            ) {
              const existing = await lookupSubscriptionByAddress(address)
              if (existing != null) {
                if (existing.attr.url === EXPECTED_WEBHOOK_URL) {
                  return existing.id
                }
                if (isOwnedWebhookUrl(existing.attr.url)) {
                  await updateSubscriptionUrl(existing.id, EXPECTED_WEBHOOK_URL)
                  return existing.id
                }
              }
              throw new Error(
                'Tatum subscription already exists for address but is not owned by this server'
              )
            }
          }
          // Only retry on 5xx server errors
          if (response.status >= 500) {
            lastError = new Error(
              `Tatum createSubscription HTTP ${response.status}: ${text}`
            )
            continue
          }
          throw new Error(
            `Tatum createSubscription error: ${response.status} ${response.statusText} - ${text}`
          )
        }

        const data = asTatumSubscriptionResponse(await response.text())
        return data.id
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('Tatum')) {
          throw err // Non-retryable errors propagate immediately
        }
        // Network/transport errors — retry
        lastError = err
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error('createSubscription failed after max retries')
  }

  /**
   * Delete a Tatum subscription. Retries on transient failures.
   */
  async function deleteSubscription(subscriptionId: string): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        await snooze(delayMs)
      }

      try {
        const response = await fetch(
          `${TATUM_API_URL}/v4/subscription/${subscriptionId}`,
          {
            method: 'DELETE',
            headers: makeHeaders()
          }
        )

        if (response.ok || response.status === 404) {
          return // Success or already deleted
        }

        if (response.status === 429 || response.status >= 500) {
          const text = await response.text()
          lastError = new Error(
            `Tatum deleteSubscription HTTP ${response.status}: ${text}`
          )
          continue
        }

        const text = await response.text()
        throw new Error(
          `Tatum deleteSubscription error: ${response.status} ${response.statusText} - ${text}`
        )
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('Tatum')) {
          throw err
        }
        lastError = err
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error('deleteSubscription failed after max retries')
  }

  /**
   * Scan an address to determine if it has any updates since `checkpoint`.
   * Returns true if there are new transactions, false if already up-to-date.
   */
  async function scanAddress(
    address: string,
    checkpoint?: string
  ): Promise<boolean> {
    if (checkpoint == null) {
      return true
    }

    // Tatum's /v4/data/transactions endpoint only supports a subset of chains.
    // For unsupported chains, skip scanning and rely on webhook delivery.
    if (!TATUM_TRANSACTION_SCAN_CHAINS.has(chain)) {
      return true
    }

    const normalizedAddress = normalizeAddress(address)
    const fromBlock = Number(checkpoint) + 1

    const params = new URLSearchParams({
      chain,
      addresses: normalizedAddress,
      fromBlock: fromBlock.toString(),
      pageSize: '1'
    })

    const headers = makeHeaders()
    const response = await fetch(
      `${TATUM_API_URL}/v4/data/transactions?${params.toString()}`,
      { headers }
    )

    if (response.status === 429) {
      throw new Error('Tatum rate limit exceeded')
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Tatum scan error: ${response.status} ${response.statusText} - ${text}`
      )
    }

    const data = asTatumTransactionsResponse(await response.text())
    return data.result.length > 0
  }

  /**
   * Incoming webhook handler registered with the WebhookRegistry.
   *
   * Processing order:
   *  1. Parse raw body
   *  2. Verify HMAC-SHA256 signature (X-Tatum-Signature header)
   *  3. Check idempotency (txId already processed → 200 OK, no re-emit)
   *  4. Emit update event for tracked address
   */
  const webhookRoute: WebhookRoute = async request => {
    const rawBody: string =
      typeof request.req.body === 'string' ? request.req.body : ''

    // --- Parse payload ---
    let payload: TatumWebhookPayload
    try {
      payload = asTatumWebhookPayload(rawBody)
    } catch (err: unknown) {
      logger.warn({ err, rawBody }, 'Invalid Tatum webhook payload')
      return {
        status: 400,
        headers: { 'content-type': 'text/plain' },
        body: 'Invalid payload'
      }
    }

    // --- Signature verification ---
    const signature = request.headers['x-tatum-signature']
    if (typeof signature !== 'string') {
      const secret = serverConfig.tatumHmacSecret
      if (secret != null && secret !== '') {
        logger.warn({ pluginId }, 'Missing X-Tatum-Signature header')
        return {
          status: 401,
          headers: { 'content-type': 'text/plain' },
          body: 'Missing signature'
        }
      }
    } else if (!verifySignature(rawBody, signature)) {
      logger.warn({ pluginId }, 'Invalid Tatum webhook signature')
      return {
        status: 401,
        headers: { 'content-type': 'text/plain' },
        body: 'Invalid signature'
      }
    }

    // --- Idempotency ---
    // Key on txId + address so the same tx touching two subscribed
    // addresses is processed for each address independently.
    const normalizedAddress = normalizeAddress(payload.address)
    if (payload.txId != null) {
      const idempotencyKey = `${payload.txId}:${normalizedAddress}`
      if (processedKeys.has(idempotencyKey)) {
        logger.info(
          { txId: payload.txId, pluginId },
          'Duplicate webhook delivery, ignoring'
        )
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'OK'
        }
      }
      markProcessed(idempotencyKey)
    }

    // --- Emit update for tracked address ---
    if (subscriptions.has(normalizedAddress)) {
      emit('update', {
        address: normalizedAddress,
        checkpoint:
          payload.blockNumber != null
            ? payload.blockNumber.toString()
            : undefined
      })
    }

    return {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'OK'
    }
  }

  webhookRegistry.registerHandler(WEBHOOK_KEY, webhookRoute)
  initialize().catch((err: unknown) => {
    allSubscriptionsPromise = undefined
    logger.error({ err }, 'Failed to initialize on startup')
  })

  const plugin: AddressPlugin = {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)

      try {
        await initialize()
        if (subscriptions.has(normalized)) {
          return true
        }

        const subscriptionId = await createSubscription(address)
        subscriptions.set(normalized, subscriptionId)
        logger.info({ address, subscriptionId }, 'Created subscription')
        return true
      } catch (err: unknown) {
        logger.error({ err, address }, 'Failed to subscribe')
        return false
      }
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)
      const subscriptionId = subscriptions.get(normalized)
      if (subscriptionId == null) {
        return false
      }

      try {
        await deleteSubscription(subscriptionId)
        subscriptions.delete(normalized)
        logger.info(
          { address: normalized, subscriptionId },
          'Deleted subscription'
        )
        return true
      } catch (err: unknown) {
        logger.error({ err, address: normalized }, 'Failed to unsubscribe')
        return false
      }
    },

    scanAddress,

    destroy() {
      webhookRegistry.unregisterHandler(WEBHOOK_KEY, webhookRoute)

      subscriptions.clear()
      processedKeys.clear()
    }
  }

  return plugin
}

//
// Cleaners & Types
//

const asTatumSubscriptionResponse = asJSON(
  asObject({
    id: asString
  })
)

const asTatumSubscriptionInfo = asObject({
  id: asString,
  type: asString,
  attr: asObject({
    address: asString,
    chain: asString,
    url: asString
  })
})

type TatumSubscriptionInfo = ReturnType<typeof asTatumSubscriptionInfo>

const asTatumSubscriptionsResponse = asJSON(asArray(asTatumSubscriptionInfo))

const asTatumErrorResponse = asJSON(
  asObject({
    errorCode: asOptional(asString),
    message: asOptional(asString)
  })
)

function parseTatumErrorBody(text: string): TatumErrorResponse | undefined {
  try {
    return asTatumErrorResponse(text)
  } catch {
    return undefined
  }
}

type TatumErrorResponse = ReturnType<typeof asTatumErrorResponse>

const asTatumTransactionsResponse = asJSON(
  asObject({
    result: asArray(
      asObject({
        blockNumber: asNumber,
        hash: asString
      })
    ),
    prevPage: asOptional(asString),
    nextPage: asOptional(asString)
  })
)

/**
 * Tatum ADDRESS_EVENT webhook payload.
 *
 * Example:
 * ```json
 * {
 *   "address": "0xF64E82131BE01618487Da5142fc9d289cbb60E9d",
 *   "amount": "0.001",
 *   "asset": "ETH",
 *   "blockNumber": 2913059,
 *   "counterAddress": "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
 *   "txId": "0x062d236ccc044f68194a04008e98c3823271dc26160a4db9ae9303f9ecfc7bf6",
 *   "type": "native",
 *   "chain": "ethereum-mainnet",
 *   "subscriptionType": "ADDRESS_EVENT"
 * }
 * ```
 */
const asTatumWebhookPayload = asJSON(
  asObject({
    address: asString,
    txId: asOptional(asString),
    blockNumber: asOptional(asNumber),
    type: asOptional(asString),
    chain: asOptional(asString),
    asset: asOptional(asString),
    amount: asOptional(asString),
    counterAddress: asOptional(asString),
    subscriptionType: asOptional(asString)
  })
)

type TatumWebhookPayload = ReturnType<typeof asTatumWebhookPayload>
