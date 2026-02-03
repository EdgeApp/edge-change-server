import { AlchemyNotifyApi } from './alchemyNotifyApi'
import { Logger, makeLogger } from './logger'

export interface SigningKeyStore {
  /** Store a signing key for a webhook */
  setSigningKey: (webhookId: string, signingKey: string) => void

  /** Get signing key for a webhook, recovering from API if not cached */
  getSigningKey: (webhookId: string) => Promise<string | undefined>

  /** Recover all signing keys from the Alchemy API */
  recoverSigningKeys: () => Promise<void>
}

export interface SigningKeyStoreOptions {
  notifyApi: AlchemyNotifyApi
}

/**
 * Creates a store for webhook signing keys.
 * Caches signing keys in memory and can recover them from the Alchemy API
 * after server restarts.
 */
export function makeSigningKeyStore(
  opts: SigningKeyStoreOptions
): SigningKeyStore {
  const { notifyApi } = opts
  const logger: Logger = makeLogger('signing-key-store')

  // In-memory cache: webhookId -> signingKey
  const signingKeys = new Map<string, string>()

  // Track if we've attempted recovery to avoid repeated API calls
  let hasRecovered = false

  return {
    setSigningKey(webhookId: string, signingKey: string) {
      signingKeys.set(webhookId, signingKey)
      logger.info({ webhookId, msg: 'Stored signing key' })
    },

    async getSigningKey(webhookId: string): Promise<string | undefined> {
      // Check cache first
      let signingKey = signingKeys.get(webhookId)
      if (signingKey != null) {
        return signingKey
      }

      // If not in cache and we haven't tried recovery, do it now
      if (!hasRecovered) {
        logger.info({
          webhookId,
          msg: 'Signing key not cached, recovering from API'
        })
        await this.recoverSigningKeys()
        signingKey = signingKeys.get(webhookId)
      }

      if (signingKey == null) {
        logger.warn({ webhookId, msg: 'Signing key not found' })
      }

      return signingKey
    },

    async recoverSigningKeys(): Promise<void> {
      try {
        logger.info({ msg: 'Recovering signing keys from Alchemy API' })
        const webhooks = await notifyApi.getTeamWebhooks()

        for (const webhook of webhooks) {
          signingKeys.set(webhook.id, webhook.signing_key)
        }

        hasRecovered = true
        logger.info({
          count: webhooks.length,
          msg: 'Recovered signing keys'
        })
      } catch (error) {
        logger.error({ err: error, msg: 'Failed to recover signing keys' })
        throw error
      }
    }
  }
}
