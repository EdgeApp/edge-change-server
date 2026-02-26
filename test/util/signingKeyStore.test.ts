import { describe, expect, jest, test } from '@jest/globals'

import { AlchemyNotifyApi } from '../../src/util/alchemyNotifyApi'
import { makeSigningKeyStore } from '../../src/util/signingKeyStore'

jest.mock('../../src/serverConfig', () => ({
  serverConfig: {
    publicUri: 'https://my.edge.app'
  }
}))

describe('makeSigningKeyStore', function () {
  test('recovers only signing keys for this server webhook URL', async function () {
    const notifyApi = {
      getTeamWebhooks: jest.fn(async () => [
        {
          id: 'owned-webhook-id',
          network: 'ETH_MAINNET',
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: 'https://my.edge.app/webhook/alchemy/ethereum',
          is_active: true,
          time_created: Date.now(),
          signing_key: 'owned-signing-key',
          version: 'V2'
        },
        {
          id: 'foreign-webhook-id',
          network: 'ETH_MAINNET',
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: 'https://other.edge.app/webhook/alchemy/ethereum',
          is_active: true,
          time_created: Date.now(),
          signing_key: 'foreign-signing-key',
          version: 'V2'
        }
      ])
    }

    const signingKeyStore = makeSigningKeyStore({
      notifyApi: (notifyApi as unknown) as AlchemyNotifyApi
    })

    await signingKeyStore.recoverSigningKeys()

    await expect(
      signingKeyStore.getSigningKey('owned-webhook-id')
    ).resolves.toBe('owned-signing-key')
    await expect(
      signingKeyStore.getSigningKey('foreign-webhook-id')
    ).resolves.toBeUndefined()
  })
})
