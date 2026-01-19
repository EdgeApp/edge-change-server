import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from '@jest/globals'

import { makeAlchemy } from '../../src/plugins/alchemy'
import { AddressPlugin } from '../../src/types/addressPlugin'
import {
  AlchemyActivity,
  AlchemyWebhookHandler,
  WebhookActivityHandler
} from '../../src/util/alchemyWebhookHandler'

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
          signing_key: 'test-signing-key',
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
      deleteWebhook: jest.fn().mockImplementation(async () => undefined)
    }))
  }
})

// Mock server config
jest.mock('../../src/serverConfig', () => ({
  serverConfig: {
    publicUri: 'https://test.edge.app',
    alchemyWebhookSigningKey: 'test-signing-key',
    webhookHost: '127.0.0.1',
    webhookPort: 8010,
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
  let mockWebhookHandler: AlchemyWebhookHandler
  let registeredHandler: WebhookActivityHandler | null = null

  function callRegisteredHandler(
    network: string,
    activity: AlchemyActivity[]
  ): void {
    if (registeredHandler == null) {
      throw new Error('registeredHandler is null')
    }
    registeredHandler(network, activity)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    registeredHandler = null

    // Create mock webhook handler
    mockWebhookHandler = {
      registerNetworkHandler: jest.fn(
        (network: string, handler: WebhookActivityHandler) => {
          registeredHandler = handler
        }
      ),
      unregisterNetworkHandler: jest.fn(),
      start: jest.fn(),
      stop: jest.fn()
    }

    plugin = makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      webhookHandler: mockWebhookHandler
    })
  })

  afterEach(() => {
    plugin.destroy?.()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  test('plugin instantiation', () => {
    expect(plugin.pluginId).toBe('ethereum')
    expect(mockWebhookHandler.registerNetworkHandler).toHaveBeenCalledWith(
      'ETH_MAINNET',
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
    const activity: AlchemyActivity[] = [
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
    callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '256' // 0x100 in decimal
    })
  })

  test('webhook activity should trigger update event for to address', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '512' // 0x200 in decimal
    })
  })

  test('webhook activity should not trigger for unsubscribed addresses', async () => {
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).not.toHaveBeenCalled()
  })

  test('multiple addresses should all receive updates', async () => {
    await plugin.subscribe(TEST_ADDRESS)
    await plugin.subscribe(TEST_SECOND_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

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

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

    // Should emit with original case
    expect(updateHandler).toHaveBeenCalledWith({
      address: mixedCaseAddress,
      checkpoint: '256'
    })
  })

  test('destroy should unregister handler and clear state', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    plugin.destroy?.()

    expect(mockWebhookHandler.unregisterNetworkHandler).toHaveBeenCalledWith(
      'ETH_MAINNET'
    )
  })

  test('ERC20 token transfer activity should trigger update', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '1024'
    })
  })

  test('internal transfer activity should trigger update', async () => {
    await plugin.subscribe(TEST_ADDRESS)

    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    const activity: AlchemyActivity[] = [
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

    callRegisteredHandler('ETH_MAINNET', activity)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ADDRESS,
      checkpoint: '1280'
    })
  })
})
