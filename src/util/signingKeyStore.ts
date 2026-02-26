import { serverConfig } from '../serverConfig'
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

  let hasRecovered = false
  let recoveringPromise: Promise<void> | null = null

  async function doRecover(): Promise<void> {
    logger.info({ msg: 'Recovering signing keys from Alchemy API' })
    const webhooks = await notifyApi.getTeamWebhooks()
    const webhookPrefix = `${serverConfig.publicUri}/webhook/`
    let recoveredCount = 0

    for (const webhook of webhooks) {
      // Only trust webhook IDs owned by this server endpoint.
      if (!webhook.webhook_url.startsWith(webhookPrefix)) continue
      signingKeys.set(webhook.id, webhook.signing_key)
      recoveredCount++
    }

    hasRecovered = true
    logger.info({
      count: recoveredCount,
      msg: 'Recovered signing keys'
    })
  }

  return {
    setSigningKey(webhookId: string, signingKey: string) {
      signingKeys.set(webhookId, signingKey)
      logger.info({ webhookId, msg: 'Stored signing key' })
    },

    async getSigningKey(webhookId: string): Promise<string | undefined> {
      let signingKey = signingKeys.get(webhookId)
      if (signingKey != null) {
        return signingKey
      }

      if (!hasRecovered) {
        logger.info({
          webhookId,
          msg: 'Signing key not cached, recovering from API'
        })
        try {
          await this.recoverSigningKeys()
        } catch {
          // Recovery failed; return undefined so handler responds 401
        }
        signingKey = signingKeys.get(webhookId)
      }

      if (signingKey == null) {
        logger.warn({ webhookId, msg: 'Signing key not found' })
      }

      return signingKey
    },

    async recoverSigningKeys(): Promise<void> {
      if (recoveringPromise != null) return await recoveringPromise

      recoveringPromise = doRecover()
      try {
        await recoveringPromise
      } finally {
        recoveringPromise = null
      }
    }
  }
}
