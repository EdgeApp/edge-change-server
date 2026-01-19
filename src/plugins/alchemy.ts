import {
  asArray,
  asBoolean,
  asEither,
  asJSON,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'
import crypto from 'crypto'
import { makeEvents } from 'yavent'

import { serverConfig } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import {
  AlchemyNetwork,
  AlchemyNotifyApi,
  WebhookInfo
} from '../util/alchemyNotifyApi'
import { Logger, makeLogger } from '../util/logger'
import { SigningKeyStore } from '../util/signingKeyStore'
import { WebhookRegistry, WebhookRoute } from '../util/webhookRegistry'

// Module-level cached promise (shared across all makeAlchemy instances).
// Reset to undefined on failure so retries can create a fresh promise.
let teamWebhooksPromise: Promise<WebhookInfo[]> | undefined

export interface AlchemyOptions {
  pluginId: string
  network: AlchemyNetwork
  notifyApi: AlchemyNotifyApi
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
  /** Normalize addresses for comparison. Defaults to identity (no normalization). */
  normalizeAddress?: (address: string) => string
}

/**
 * Creates an Alchemy Address Activity webhook plugin.
 *
 * This plugin uses Alchemy's webhook infrastructure to receive real-time
 * notifications when tracked addresses have on-chain activity.
 */
export function makeAlchemy(opts: AlchemyOptions): AddressPlugin {
  const {
    pluginId,
    network,
    notifyApi,
    signingKeyStore,
    webhookRegistry,
    normalizeAddress = addr => addr
  } = opts

  const WEBHOOK_KEY = `alchemy/${pluginId}`

  const [on, emit] = makeEvents<PluginEvents>()

  const logger: Logger = makeLogger('alchemy', pluginId)

  // Track subscribed addresses (normalized address -> original address)
  const subscribedAddresses = new Map<string, string>()

  // Webhook ID for this network (discovered or created on first subscription)
  let webhookId: string | null = null

  // Whether we've initialized (checked for existing webhooks)
  let initialized = false
  let initializingPromise: Promise<void> | null = null

  // Pending address changes to batch
  let pendingAddressesToAdd: string[] = []
  let pendingAddressesToRemove: string[] = []
  let batchTimeout: ReturnType<typeof setTimeout> | null = null

  // Batch delay in milliseconds (debounce address updates)
  const BATCH_DELAY_MS = 1000
  const MAX_RETRY_DELAY_MS = 60_000

  let destroyed = false
  let processing = false
  let retryCount = 0

  /**
   * Initialize the plugin by discovering existing webhooks.
   * Deletes paused webhooks and reuses active ones.
   */
  async function initialize(): Promise<void> {
    if (initialized) return
    if (initializingPromise != null) return await initializingPromise

    initializingPromise = doInitialize()
    await initializingPromise
    initializingPromise = null
  }

  async function doInitialize(): Promise<void> {
    logger.info({ msg: 'Discovering existing webhooks' })

    // Create or reuse shared promise for team webhooks
    if (teamWebhooksPromise == null) {
      teamWebhooksPromise = notifyApi.getTeamWebhooks()
    }

    try {
      const webhooks = await teamWebhooksPromise
      const expectedUrl = `${serverConfig.publicUri}/webhook/${WEBHOOK_KEY}`

      // Find webhooks for this network
      const networkWebhooks = webhooks.filter(
        (w: WebhookInfo) =>
          w.network === network && w.webhook_type === 'ADDRESS_ACTIVITY'
      )

      for (const webhook of networkWebhooks) {
        if (!webhook.is_active) {
          // Delete paused webhooks
          logger.info({
            webhookId: webhook.id,
            msg: 'Deleting paused webhook'
          })
          try {
            await notifyApi.deleteWebhook(webhook.id)
          } catch (err) {
            logger.warn({
              err,
              webhookId: webhook.id,
              msg: 'Failed to delete paused webhook'
            })
          }
        } else if (webhookId == null) {
          // Reuse first active webhook
          webhookId = webhook.id
          signingKeyStore.setSigningKey(webhook.id, webhook.signing_key)

          // Update URL if different
          if (webhook.webhook_url !== expectedUrl) {
            logger.info({
              webhookId: webhook.id,
              oldUrl: webhook.webhook_url,
              newUrl: expectedUrl,
              msg: 'Updating webhook URL'
            })
            try {
              await notifyApi.updateWebhook({
                webhookId: webhook.id,
                webhookUrl: expectedUrl
              })
            } catch (err) {
              logger.error({
                err,
                webhookId: webhook.id,
                msg: 'Failed to update webhook URL'
              })
            }
          }

          logger.info({
            webhookId: webhook.id,
            msg: 'Reusing existing webhook'
          })
        } else {
          // Delete extra active webhooks (we only need one per network)
          logger.info({
            webhookId: webhook.id,
            msg: 'Deleting extra webhook'
          })
          try {
            await notifyApi.deleteWebhook(webhook.id)
          } catch (err) {
            logger.warn({
              err,
              webhookId: webhook.id,
              msg: 'Failed to delete extra webhook'
            })
          }
        }
      }

      initialized = true
      logger.info({
        webhookId,
        msg: 'Webhook discovery complete'
      })
    } catch (err: unknown) {
      // Reset promise on failure so next retry creates a fresh one
      teamWebhooksPromise = undefined
      logger.error({ err, msg: 'Failed to discover webhooks' })
      throw err
    }
  }

  /**
   * Handle incoming activity from the webhook
   */
  function handleActivity(activities: AlchemyActivity[]): void {
    // Track which subscribed addresses have updates
    const addressesToUpdate = new Set<string>()

    for (const activity of activities) {
      const normalizedFrom = normalizeAddress(activity.fromAddress)
      const normalizedTo = normalizeAddress(activity.toAddress)

      // Check if fromAddress is subscribed
      const originalFrom = subscribedAddresses.get(normalizedFrom)
      if (originalFrom != null) {
        addressesToUpdate.add(originalFrom)
      }

      // Check if toAddress is subscribed
      const originalTo = subscribedAddresses.get(normalizedTo)
      if (originalTo != null) {
        addressesToUpdate.add(originalTo)
      }
    }

    // Derive checkpoint from the highest block number across activities
    let maxBlock = -1
    for (const activity of activities) {
      const n = parseInt(activity.blockNum, 16)
      if (!Number.isNaN(n) && n > maxBlock) maxBlock = n
    }
    const checkpoint = maxBlock >= 0 ? maxBlock.toString() : undefined

    for (const address of addressesToUpdate) {
      emit('update', { address, checkpoint })
    }
  }

  /**
   * Process batched address changes
   */
  async function processBatchedChanges(): Promise<void> {
    batchTimeout = null
    if (destroyed || processing) {
      if (processing) scheduleBatch()
      return
    }
    processing = true

    const toAdd = pendingAddressesToAdd
    const toRemove = pendingAddressesToRemove
    pendingAddressesToAdd = []
    pendingAddressesToRemove = []

    if (toAdd.length === 0 && toRemove.length === 0) {
      processing = false
      return
    }

    try {
      await initialize()

      if (webhookId == null && toAdd.length > 0) {
        const webhookUrl = `${serverConfig.publicUri}/webhook/${WEBHOOK_KEY}`
        logger.info({ network, msg: 'Creating webhook' })

        const response = await notifyApi.createWebhook({
          network,
          webhookUrl,
          addresses: [...toAdd]
        })

        webhookId = response.data.id
        signingKeyStore.setSigningKey(webhookId, response.data.signing_key)
        logger.info({ webhookId, msg: 'Created webhook' })

        toAdd.length = 0
      }

      if (webhookId != null && (toAdd.length > 0 || toRemove.length > 0)) {
        logger.info({
          added: toAdd.length,
          removed: toRemove.length,
          msg: 'Updating addresses'
        })

        await notifyApi.updateWebhookAddresses({
          webhookId,
          addressesToAdd: toAdd.length > 0 ? toAdd : undefined,
          addressesToRemove: toRemove.length > 0 ? toRemove : undefined
        })
      }

      if (webhookId != null && subscribedAddresses.size === 0) {
        logger.info({ webhookId, msg: 'Deleting webhook (no subscriptions)' })
        try {
          await notifyApi.deleteWebhook(webhookId)
          webhookId = null
        } catch (err) {
          logger.warn({ err, msg: 'Failed to delete empty webhook' })
        }
      }

      retryCount = 0
    } catch (err: unknown) {
      logger.error({ err, msg: 'Failed to update webhook addresses' })

      if (!destroyed) {
        pendingAddressesToAdd.push(...toAdd)
        pendingAddressesToRemove.push(...toRemove)

        retryCount++
        const delay = Math.min(
          BATCH_DELAY_MS * Math.pow(2, retryCount),
          MAX_RETRY_DELAY_MS
        )
        scheduleBatch(delay)
      }
    } finally {
      processing = false
    }
  }

  /**
   * Schedule a deferred batch update to sync pending address subscribe/
   * unsubscribe changes with the Alchemy webhook API. Calls are debounced
   * so that rapid successive subscribe/unsubscribe calls are coalesced
   * into a single API request after the given delay.
   */
  function scheduleBatch(delay: number = BATCH_DELAY_MS): void {
    // If a longer delay is requested (backoff), cancel existing shorter timeout
    if (batchTimeout != null && delay > BATCH_DELAY_MS) {
      clearTimeout(batchTimeout)
      batchTimeout = null
    }
    if (batchTimeout == null) {
      batchTimeout = setTimeout(() => {
        processBatchedChanges().catch((err: unknown) => {
          logger.error({ err, msg: 'Batch processing error' })
        })
      }, delay)
    }
  }

  // Broadcast webhook activity to other cluster workers via IPC so
  // every worker can match incoming activity against its own
  // subscribedAddresses map (fixes round-robin webhook delivery).
  function handleActivityAndBroadcast(activities: AlchemyActivity[]): void {
    handleActivity(activities)
    if (typeof process.send === 'function') {
      process.send({
        type: 'webhook-activity',
        pluginId,
        activities
      })
    }
  }

  // Listen for activity broadcasts relayed from other workers
  const ipcHandler = (message: unknown): void => {
    if (
      message != null &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'webhook-activity' &&
      (message as { pluginId?: string }).pluginId === pluginId
    ) {
      handleActivity((message as { activities: AlchemyActivity[] }).activities)
    }
  }
  process.on('message', ipcHandler)

  const webhookRoute = makeWebhookRoute(
    logger,
    network,
    signingKeyStore,
    handleActivityAndBroadcast
  )

  // Register this plugin's handler with the webhook registry
  webhookRegistry.registerHandler(WEBHOOK_KEY, webhookRoute)

  // Initialize immediately on plugin creation (cleanup paused webhooks, discover existing)
  initialize().catch((err: unknown) => {
    logger.error({ err, msg: 'Failed to initialize on startup' })
  })

  const plugin: AddressPlugin = {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)

      if (subscribedAddresses.has(normalized)) {
        return true
      }

      subscribedAddresses.set(normalized, address)

      pendingAddressesToAdd.push(normalized)

      const removeIndex = pendingAddressesToRemove.indexOf(normalized)
      if (removeIndex !== -1) {
        pendingAddressesToRemove.splice(removeIndex, 1)
      }

      scheduleBatch()

      return true
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)

      if (!subscribedAddresses.has(normalized)) {
        return false
      }

      subscribedAddresses.delete(normalized)

      pendingAddressesToRemove.push(normalized)

      const addIndex = pendingAddressesToAdd.indexOf(normalized)
      if (addIndex !== -1) {
        pendingAddressesToAdd.splice(addIndex, 1)
      }

      scheduleBatch()

      return true
    },

    // Note: scanAddress is not implemented for Alchemy webhooks
    // The webhook model pushes updates, so scanning is not needed.
    // If needed in future, could use Alchemy Transfers API.

    destroy() {
      destroyed = true

      if (batchTimeout != null) {
        clearTimeout(batchTimeout)
        batchTimeout = null
      }

      process.removeListener('message', ipcHandler)
      webhookRegistry.unregisterHandler(WEBHOOK_KEY, webhookRoute)

      subscribedAddresses.clear()
      pendingAddressesToAdd = []
      pendingAddressesToRemove = []
    }
  }

  return plugin
}

/**
 * Validates the webhook signature using HMAC-SHA256
 */
function validateSignature(
  rawBody: string,
  signature: string,
  signingKey: string
): boolean {
  const hmac = crypto.createHmac('sha256', signingKey)
  hmac.update(rawBody, 'utf8')
  const expectedSignature = hmac.digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    // Lengths don't match
    return false
  }
}

/**
 * Handle incoming raw webhook from the registry.
 * Parses and validates the Alchemy payload, then processes activity.
 */
const makeWebhookRoute = (
  logger: Logger,
  network: AlchemyNetwork,
  signingKeyStore: SigningKeyStore,
  handleActivity: (activities: AlchemyActivity[]) => void
): WebhookRoute => async request => {
  const rawBody: string =
    typeof request.req.body === 'string' ? request.req.body : ''

  // Parse the raw body into an Alchemy payload
  let alchemyPayload: AlchemyWebhookPayload
  try {
    alchemyPayload = asAlchemyWebhookPayload(rawBody)
  } catch (err: unknown) {
    // Not a valid Alchemy payload; ignore
    logger.warn({ err, rawBody, msg: 'Invalid payload' })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Invalid payload'
    }
  }

  // Authenticate before any authorization checks (network, type) to
  // avoid leaking which network an endpoint serves to unauthenticated
  // callers.
  const signature = request.headers['x-alchemy-signature']
  if (typeof signature !== 'string') {
    logger.warn({ msg: 'Missing X-Alchemy-Signature header' })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Missing signature'
    }
  }

  const key = await signingKeyStore.getSigningKey(alchemyPayload.webhookId)
  if (key == null) {
    logger.error({
      webhookId: alchemyPayload.webhookId,
      msg: 'Unknown webhook ID'
    })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Unknown webhook'
    }
  }

  if (!validateSignature(rawBody, signature, key)) {
    logger.warn({
      webhookId: alchemyPayload.webhookId,
      msg: 'Invalid webhook signature'
    })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Invalid signature'
    }
  }

  // Only handle webhooks for this plugin's network
  if (alchemyPayload.event.network !== network)
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: 'Network mismatch'
    }

  // Validate payload type
  if (alchemyPayload.type !== 'ADDRESS_ACTIVITY') {
    logger.warn({
      type: alchemyPayload.type,
      msg: 'Unexpected webhook type'
    })
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: 'Unexpected webhook type'
    }
  }

  // Process activity
  handleActivity(alchemyPayload.event.activity)

  return {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'OK'
  }
}
//
// Cleaners & Types
//

const asAlchemyActivity = asObject({
  blockNum: asString,
  hash: asString,
  fromAddress: asString,
  toAddress: asString,
  value: asNumber,
  erc721TokenId: asOptional(asEither(asString, asNull)),
  erc1155Metadata: asOptional(
    asEither(asArray(asObject({ tokenId: asString, value: asString })), asNull)
  ),
  asset: asString,
  category: asValue(
    'external',
    'internal',
    'erc20',
    'erc721',
    'erc1155',
    'token'
  ),
  rawContract: asObject({
    rawValue: asString,
    address: asOptional(asString),
    decimals: asOptional(asNumber)
  }),
  typeTraceAddress: asOptional(asEither(asString, asNull)),
  log: asOptional(
    asObject({
      address: asString,
      topics: asArray(asString),
      data: asString,
      blockNumber: asString,
      transactionHash: asString,
      transactionIndex: asString,
      blockHash: asString,
      logIndex: asString,
      removed: asBoolean
    })
  )
})

export type AlchemyActivity = ReturnType<typeof asAlchemyActivity>

const asAlchemyWebhookPayload = asJSON(
  asObject({
    webhookId: asString,
    id: asString,
    createdAt: asString,
    type: asString,
    event: asObject({
      network: asString,
      activity: asArray(asAlchemyActivity)
    })
  })
)

type AlchemyWebhookPayload = ReturnType<typeof asAlchemyWebhookPayload>
