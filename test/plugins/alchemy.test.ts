import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from '@jest/globals'
import crypto from 'crypto'
import { HttpResponse } from 'serverlet'

import { makeAlchemy } from '../../src/plugins/alchemy'
import { AddressPlugin } from '../../src/types/addressPlugin'
import { makeAlchemyNotifyApi } from '../../src/util/alchemyNotifyApi'
import { SigningKeyStore } from '../../src/util/signingKeyStore'
import { WebhookRegistry, WebhookRoute } from '../../src/util/webhookRegistry'

const TEST_SIGNING_KEY = 'test-signing-key'
const notifyApi = makeAlchemyNotifyApi()

function computeSignature(body: string, key: string): string {
  return crypto.createHmac('sha256', key).update(body, 'utf8').digest('hex')
}

// Mock the Alchemy Notify API
jest.mock('../../src/util/alchemyNotifyApi', () => {
  return {
    makeAlchemyNotifyApi: jest.fn(() => ({
      createWebhook: jest.fn().mockImplementation(async () => ({
        data: {
          id: 'test-webhook-id',
          network: 'ETH_MAINNET',
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: 'https://test.com/webhook',
          is_active: true,
          time_created: Date.now(),
          signing_key: TEST_SIGNING_KEY,
          version: 'V2'
        }
      })),
      updateWebhookAddresses: jest
        .fn()
        .mockImplementation(async () => undefined),
      getWebhookAddresses: jest.fn().mockImplementation(async () => ({
        data: [],
        pagination: { cursors: {}, total_count: 0 }
      })),
      getTeamWebhooks: jest.fn().mockImplementation(async () => []),
      deleteWebhook: jest.fn().mockImplementation(async () => undefined)
    }))
  }
})

// Mock server config
jest.mock('../../src/serverConfig', () => ({
  serverConfig: {
    publicUri: 'https://test.edge.app',
    alchemyAuthToken: 'test-auth-token',
    serviceKeys: {
      'dashboard.alchemy.com': ['test-api-key']
    }
  }
}))

describe('Alchemy plugin', () => {
  const TEST_ADDRESS = '0xF5335367A46c2484f13abd051444E39775EA7b60'
  const TEST_ADDRESS_LOWERCASE = TEST_ADDRESS.toLowerCase()
  const TEST_SECOND_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

  let plugin: AddressPlugin
  let mockSigningKeyStore: SigningKeyStore
  let mockWebhookRegistry: WebhookRegistry
  let registeredHandler: WebhookRoute | null = null

  /**
   * Builds a full Alchemy webhook payload and calls the registered handler
   * with proper headers (including HMAC signature) and JSON body.
   */
  async function callRegisteredHandler(
    network: string,
    activity: unknown[]
  ): Promise<HttpResponse> {
    if (registeredHandler == null) {
      throw new Error('registeredHandler is null')
    }
    const body = JSON.stringify({
      webhookId: 'test-webhook-id',
      id: 'test-event-id',
      createdAt: new Date().toISOString(),
      type: 'ADDRESS_ACTIVITY',
      event: { network, activity }
    })
    const signature = computeSignature(body, TEST_SIGNING_KEY)
    return await registeredHandler({
      method: 'POST',
      path: '/webhook/alchemy/ethereum',
      version: '1.1',
      headers: { 'x-alchemy-signature': signature },
      req: { body } as any
    })
  }

  /**
   * Calls the handler with a raw body + custom headers (for testing
   * invalid/missing signatures).
   */
  async function callHandlerRaw(
    body: string,
    headers: Record<string, string> = {}
  ): Promise<HttpResponse> {
    if (registeredHandler == null) {
      throw new Error('registeredHandler is null')
    }
    return await registeredHandler({
      method: 'POST',
      path: '/webhook/alchemy/ethereum',
      version: '1.1',
      headers,
      req: { body } as any
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    registeredHandler = null

    // Create mock signing key store
    mockSigningKeyStore = ({
      setSigningKey: jest.fn(),
      getSigningKey: jest.fn(async () => TEST_SIGNING_KEY),
      recoverSigningKeys: jest.fn(async () => undefined)
    } as unknown) as SigningKeyStore

    // Create mock webhook registry
    mockWebhookRegistry = {
      registerHandler: jest.fn((_webhookKey: string, handler: WebhookRoute) => {
        registeredHandler = handler
      }),
      unregisterHandler: jest.fn(),
      handleWebhook: jest.fn(async () => ({ status: 200, body: 'OK' }))
    }

    plugin = makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      notifyApi: notifyApi,
      signingKeyStore: mockSigningKeyStore,
      webhookRegistry: mockWebhookRegistry,
      normalizeAddress: address => address.toLowerCase()
    })
  })

  afterEach(() => {
    plugin.destroy?.()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  test('plugin instantiation', () => {
    expect(plugin.pluginId).toBe('ethereum')
    expect(mockWebhookRegistry.registerHandler).toHaveBeenCalledWith(
      'alchemy/ethereum',
      expect.any(Function)
    )
  })

  test('subscribe should return true', async () => {
    const result = await plugin.subscribe(TEST_ADDRESS)
    expect(result).toBe(true)
  })

  test('subscribe should be idempotent', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    const result = await plugin.subscribe(TEST_ADDRESS)
    expect(result).toBe(true)
  })

  test('unsubscribe should return true for subscribed address', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    const result = await plugin.unsubscribe(TEST_ADDRESS)
    expect(result).toBe(true)
  })

  test('unsubscribe should return false for non-subscribed address', async () => {
    const result = await plugin.unsubscribe(TEST_ADDRESS)
    expect(result).toBe(false)
  })

  test('webhook activity should trigger update event for from address', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate incoming webhook activity
    const activity = [
      {
        blockNum: '0x100',
        hash: '0xabc',
        fromAddress: TEST_ADDRESS_LOWERCASE,
        toAddress: '0xdef',
        value: 1.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'external',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: null
      }
    ]

    // Call the registered handler
    expect(registeredHandler).not.toBeNull()
    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '256' // 0x100 in decimal
    })
  })

  test('webhook activity should trigger update event for to address', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x200',
        hash: '0xdef',
        fromAddress: '0xabc',
        toAddress: TEST_ADDRESS_LOWERCASE,
        value: 2.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'external',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: null
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '512' // 0x200 in decimal
    })
  })

  test('webhook activity should not trigger for unsubscribed addresses', async () => {
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x100',
        hash: '0xabc',
        fromAddress: TEST_ADDRESS_LOWERCASE,
        toAddress: '0xdef',
        value: 1.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'external',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: null
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).not.toHaveBeenCalled()
  })

  test('multiple addresses should all receive updates', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await plugin.subscribe(TEST_SECOND_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x300',
        hash: '0xghi',
        fromAddress: TEST_ADDRESS_LOWERCASE,
        toAddress: TEST_SECOND_ADDRESS.toLowerCase(),
        value: 1.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'external',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: null
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledTimes(2)
    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '768'
    })
    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_SECOND_ADDRESS,
      checkpoint: '768'
    })
  })

  test('address normalization preserves original case', async () => {
    const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
    await plugin.subscribe(mixedCaseAddress)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x100',
        hash: '0xabc',
        fromAddress: mixedCaseAddress.toLowerCase(),
        toAddress: '0xdef',
        value: 1.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'external',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: null
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    // Should emit with original case
    expect(updateHandler).toHaveBeenCalledWith({
      address: mixedCaseAddress,
      checkpoint: '256'
    })
  })

  test('destroy should unregister handler and clear state', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    plugin.destroy?.()

    expect(mockWebhookRegistry.unregisterHandler).toHaveBeenCalledWith(
      'alchemy/ethereum',
      expect.any(Function)
    )
  })

  test('ERC20 token transfer activity should trigger update', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x400',
        hash: '0xtoken',
        fromAddress: TEST_ADDRESS_LOWERCASE,
        toAddress: '0xrecipient',
        value: 100.0,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'USDC',
        category: 'erc20',
        rawContract: {
          rawValue: '0x5f5e100',
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6
        },
        typeTraceAddress: null
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '1024'
    })
  })

  test('internal transfer activity should trigger update', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity = [
      {
        blockNum: '0x500',
        hash: '0xinternal',
        fromAddress: '0xcontract',
        toAddress: TEST_ADDRESS_LOWERCASE,
        value: 0.5,
        erc721TokenId: null,
        erc1155Metadata: null,
        asset: 'ETH',
        category: 'internal',
        rawContract: {
          rawValue: '0x',
          address: '',
          decimals: 18
        },
        typeTraceAddress: 'call_0_1'
      }
    ]

    await callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '1280'
    })
  })

  // --- Batch processing tests ---

  test('subscribe should create webhook after batch delay', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    expect(notifyApi.createWebhook).toHaveBeenCalledWith({
      network: 'ETH_MAINNET',
      webhookUrl: 'https://test.edge.app/webhook/alchemy/ethereum',
      addresses: [TEST_ADDRESS_LOWERCASE]
    })
  })

  test('unsubscribe should delete webhook when no subscriptions remain', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    await plugin.unsubscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    expect(notifyApi.deleteWebhook).toHaveBeenCalledWith('test-webhook-id')
  })

  test('subscribe + unsubscribe in same batch should cancel each other', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await plugin.unsubscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    expect(notifyApi.createWebhook).not.toHaveBeenCalled()
  })

  test('second subscribe should call updateWebhookAddresses', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    await plugin.subscribe(TEST_SECOND_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    expect(notifyApi.updateWebhookAddresses).toHaveBeenCalledWith({
      webhookId: 'test-webhook-id',
      addressesToAdd: [TEST_SECOND_ADDRESS.toLowerCase()],
      addressesToRemove: undefined
    })
  })

  test('should ignore active webhook on same network with different URL', async () => {
    plugin.destroy?.()
    jest.clearAllMocks()
    const getTeamWebhooksMock = notifyApi.getTeamWebhooks as jest.Mock
    getTeamWebhooksMock.mockImplementationOnce(async () => [
      {
        id: 'foreign-webhook-id',
        network: 'ETH_MAINNET',
        webhook_type: 'ADDRESS_ACTIVITY',
        webhook_url: 'https://other.edge.app/webhook/alchemy/ethereum',
        is_active: true,
        time_created: Date.now(),
        signing_key: TEST_SIGNING_KEY,
        version: 'V2'
      }
    ])

    plugin = makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      notifyApi: notifyApi,
      signingKeyStore: mockSigningKeyStore,
      webhookRegistry: mockWebhookRegistry,
      normalizeAddress: address => address.toLowerCase()
    })

    await plugin.subscribe(TEST_ADDRESS)
    await jest.advanceTimersByTimeAsync(1000)

    expect(notifyApi.createWebhook).toHaveBeenCalledWith({
      network: 'ETH_MAINNET',
      webhookUrl: 'https://test.edge.app/webhook/alchemy/ethereum',
      addresses: [TEST_ADDRESS_LOWERCASE]
    })
    expect(notifyApi.deleteWebhook).not.toHaveBeenCalledWith(
      'foreign-webhook-id'
    )
  })

  // --- Signature validation tests ---

  test('missing signature header should return 401', async () => {
    const body = JSON.stringify({
      webhookId: 'test-webhook-id',
      id: 'test-event-id',
      createdAt: new Date().toISOString(),
      type: 'ADDRESS_ACTIVITY',
      event: { network: 'ETH_MAINNET', activity: [] }
    })

    const response = await callHandlerRaw(body, {})
    expect(response.status).toBe(401)
  })

  test('invalid signature should return 401', async () => {
    const body = JSON.stringify({
      webhookId: 'test-webhook-id',
      id: 'test-event-id',
      createdAt: new Date().toISOString(),
      type: 'ADDRESS_ACTIVITY',
      event: { network: 'ETH_MAINNET', activity: [] }
    })

    const response = await callHandlerRaw(body, {
      'x-alchemy-signature': 'bad-signature'
    })
    expect(response.status).toBe(401)
  })

  test('unknown webhook ID should return 401', async () => {
    ;(mockSigningKeyStore.getSigningKey as jest.Mock).mockImplementation(
      async () => undefined
    )

    const body = JSON.stringify({
      webhookId: 'unknown-webhook-id',
      id: 'test-event-id',
      createdAt: new Date().toISOString(),
      type: 'ADDRESS_ACTIVITY',
      event: { network: 'ETH_MAINNET', activity: [] }
    })
    const signature = computeSignature(body, TEST_SIGNING_KEY)

    const response = await callHandlerRaw(body, {
      'x-alchemy-signature': signature
    })
    expect(response.status).toBe(401)
  })

  test('invalid payload body should return 401', async () => {
    const response = await callHandlerRaw('not-json', {
      'x-alchemy-signature': 'anything'
    })
    expect(response.status).toBe(401)
  })
})
