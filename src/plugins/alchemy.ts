import { makeEvents } from 'yavent'

import { serverConfig } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import {
  AlchemyNetwork,
  AlchemyNotifyApi,
  makeAlchemyNotifyApi
} from '../util/alchemyNotifyApi'
import {
  AlchemyActivity,
  AlchemyWebhookHandler
} from '../util/alchemyWebhookHandler'
import { Logger, makeLogger } from '../util/logger'

export interface AlchemyOptions {
  pluginId: string
  network: AlchemyNetwork
  webhookHandler: AlchemyWebhookHandler
}

/**
 * Creates an Alchemy Address Activity webhook plugin.
 *
 * This plugin uses Alchemy's webhook infrastructure to receive real-time
 * notifications when tracked addresses have on-chain activity.
 */
export function makeAlchemy(opts: AlchemyOptions): AddressPlugin {
  const { pluginId, network, webhookHandler } = opts

  const [on, emit] = makeEvents<PluginEvents>()

  const logger: Logger = makeLogger('alchemy', pluginId)

  // Alchemy Notify API client
  const notifyApi: AlchemyNotifyApi = makeAlchemyNotifyApi(logger)

  // Track subscribed addresses (normalized lowercase address -> original address)
  const subscribedAddresses = new Map<string, string>()

  // Webhook ID for this network (created on first subscription)
  let webhookId: string | null = null

  // Pending address changes to batch
  let pendingAddressesToAdd: string[] = []
  let pendingAddressesToRemove: string[] = []
  let batchTimeout: ReturnType<typeof setTimeout> | null = null

  // Batch delay in milliseconds (debounce address updates)
  const BATCH_DELAY_MS = 1000

  /**
   * Handle incoming activity from the webhook handler
   */
  function handleActivity(
    _network: string,
    activities: AlchemyActivity[]
  ): void {
    // Track which subscribed addresses have updates
    const addressesToUpdate = new Set<string>()

    for (const activity of activities) {
      const normalizedFrom = activity.fromAddress?.toLowerCase()
      const normalizedTo = activity.toAddress?.toLowerCase()

      // Check if fromAddress is subscribed
      if (normalizedFrom != null) {
        const originalFrom = subscribedAddresses.get(normalizedFrom)
        if (originalFrom != null) {
          addressesToUpdate.add(originalFrom)
        }
      }

      // Check if toAddress is subscribed
      if (normalizedTo != null) {
        const originalTo = subscribedAddresses.get(normalizedTo)
        if (originalTo != null) {
          addressesToUpdate.add(originalTo)
        }
      }
    }

    // Emit update events for all affected subscribed addresses
    for (const address of addressesToUpdate) {
      // Use the block number from the first activity as checkpoint
      const checkpoint =
        activities.length > 0
          ? parseInt(activities[0].blockNum, 16).toString()
          : undefined
      emit('update', { address, checkpoint })
    }
  }

  /**
   * Process batched address changes
   */
  async function processBatchedChanges(): Promise<void> {
    batchTimeout = null

    const toAdd = pendingAddressesToAdd
    const toRemove = pendingAddressesToRemove
    pendingAddressesToAdd = []
    pendingAddressesToRemove = []

    if (toAdd.length === 0 && toRemove.length === 0) {
      return
    }

    try {
      // Create webhook if it doesn't exist and we have addresses to add
      if (webhookId == null && toAdd.length > 0) {
        const webhookUrl = `${serverConfig.publicUri}/webhook/alchemy`
        logger.info({ network, msg: 'Creating webhook' })

        const response = await notifyApi.createWebhook({
          network,
          webhookUrl,
          addresses: toAdd
        })

        webhookId = response.data.id
        logger.info({ webhookId, msg: 'Created webhook' })

        // Clear toAdd since they were included in creation
        toAdd.length = 0
      }

      // Update addresses if webhook exists
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
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to update webhook addresses' })

      // Re-queue failed operations
      pendingAddressesToAdd.push(...toAdd)
      pendingAddressesToRemove.push(...toRemove)

      // Retry after delay
      scheduleBatch()
    }
  }

  /**
   * Schedule batch processing
   */
  function scheduleBatch(): void {
    if (batchTimeout == null) {
      batchTimeout = setTimeout(() => {
        processBatchedChanges().catch(error => {
          logger.error({ err: error, msg: 'Batch processing error' })
        })
      }, BATCH_DELAY_MS)
    }
  }

  // Register this plugin's handler with the webhook handler
  webhookHandler.registerNetworkHandler(network, handleActivity)

  const plugin: AddressPlugin = {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalizedAddress = address.toLowerCase()

      // Check if already subscribed
      if (subscribedAddresses.has(normalizedAddress)) {
        return true
      }

      // Track locally
      subscribedAddresses.set(normalizedAddress, address)

      // Queue for batch update to Alchemy
      pendingAddressesToAdd.push(address)

      // Remove from pending removals if present
      const removeIndex = pendingAddressesToRemove.indexOf(address)
      if (removeIndex !== -1) {
        pendingAddressesToRemove.splice(removeIndex, 1)
      }

      scheduleBatch()

      return true
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalizedAddress = address.toLowerCase()

      // Check if subscribed
      if (!subscribedAddresses.has(normalizedAddress)) {
        return false
      }

      // Remove from local tracking
      subscribedAddresses.delete(normalizedAddress)

      // Queue for batch update to Alchemy
      pendingAddressesToRemove.push(address)

      // Remove from pending additions if present
      const addIndex = pendingAddressesToAdd.indexOf(address)
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
      // Clear batch timeout
      if (batchTimeout != null) {
        clearTimeout(batchTimeout)
        batchTimeout = null
      }

      // Unregister from webhook handler
      webhookHandler.unregisterNetworkHandler(network)

      // Clear local state
      subscribedAddresses.clear()
      pendingAddressesToAdd = []
      pendingAddressesToRemove = []

      // Note: We don't delete the webhook on destroy
      // It can be reused on restart, and addresses can be managed
    }
  }

  return plugin
}
