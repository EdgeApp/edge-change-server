import { makeLogger } from './logger'

/**
 * Activity event from Alchemy Address Activity webhook
 */
export interface AlchemyActivity {
  blockNum: string
  hash: string
  fromAddress: string
  toAddress: string
  value: number
  erc721TokenId: string | null
  erc1155Metadata: Array<{ tokenId: string; value: string }> | null
  asset: string
  category: 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155' | 'token'
  rawContract: {
    rawValue: string
    address: string
    decimals: number
  }
  typeTraceAddress: string | null
  log?: {
    address: string
    topics: string[]
    data: string
    blockNumber: string
    transactionHash: string
    transactionIndex: string
    blockHash: string
    logIndex: string
    removed: boolean
  }
}

/**
 * Webhook payload from Alchemy Address Activity webhook
 */
export interface AlchemyWebhookPayload {
  webhookId: string
  id: string
  createdAt: string
  type: 'ADDRESS_ACTIVITY'
  event: {
    network: string
    activity: AlchemyActivity[]
  }
}

export type WebhookActivityHandler = (
  network: string,
  activity: AlchemyActivity[]
) => void

export interface WebhookRegistry {
  /** Register a handler for a specific network */
  registerNetworkHandler: (
    network: string,
    handler: WebhookActivityHandler
  ) => void

  /** Unregister a handler for a specific network */
  unregisterNetworkHandler: (network: string) => void

  /** Handle incoming webhook activity - called by HTTP route */
  handleWebhook: (network: string, activity: AlchemyActivity[]) => void
}

/**
 * Creates a registry for webhook handlers.
 * Plugins register their handlers here, and the HTTP server routes
 * incoming webhooks to the appropriate handler.
 */
export function makeWebhookRegistry(): WebhookRegistry {
  const logger = makeLogger('webhook-registry')
  const networkHandlers = new Map<string, WebhookActivityHandler>()

  return {
    registerNetworkHandler(network: string, handler: WebhookActivityHandler) {
      networkHandlers.set(network, handler)
      logger.info({ network, msg: 'Registered webhook handler' })
    },

    unregisterNetworkHandler(network: string) {
      networkHandlers.delete(network)
      logger.info({ network, msg: 'Unregistered webhook handler' })
    },

    handleWebhook(network: string, activity: AlchemyActivity[]) {
      const handler = networkHandlers.get(network)

      if (handler != null) {
        try {
          handler(network, activity)
        } catch (error) {
          logger.error({ err: error, network, msg: 'Error in network handler' })
        }
      } else {
        logger.warn({ network, msg: 'No handler registered for network' })
      }
    }
  }
}
