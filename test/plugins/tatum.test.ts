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

import {
  makeTatum,
  TATUM_PLUGIN_IDS,
  tatumChainMap
} from '../../src/plugins/tatum'
import { AddressPlugin } from '../../src/types/addressPlugin'
import { WebhookRegistry, WebhookRoute } from '../../src/util/webhookRegistry'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_HMAC_SECRET = 'test-hmac-secret-for-tatum'

/**
 * Compute the expected X-Tatum-Signature for a given raw body + secret.
 * Matches the verifySignature logic in tatum.ts.
 */
function computeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

// NOTE: jest.mock() is hoisted before variable declarations, so we cannot
// reference TEST_HMAC_SECRET here. Use the same literal value.
jest.mock('../../src/serverConfig', () => ({
  serverConfig: {
    publicUri: 'https://test.edge.app',
    tatumHmacSecret: 'test-hmac-secret-for-tatum',
    serviceKeys: {
      'api.tatum.io': ['test-api-key']
    }
  }
}))

// Mock snooze so retry backoff delays are instant in tests
jest.mock('../../src/util/snooze', () => ({
  snooze: jest.fn().mockImplementation(async () => {})
}))

// Mock fetch for Tatum API calls
const mockFetch = jest.fn<typeof fetch>()
global.fetch = mockFetch as typeof fetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid Tatum webhook payload JSON string. */
function buildPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    address: '0xabc123',
    txId: 'tx-001',
    blockNumber: 100,
    type: 'native',
    chain: 'bitcoin-mainnet',
    subscriptionType: 'ADDRESS_EVENT',
    ...overrides
  })
}

/**
 * Create a minimal mock Response object.
 * Cast via unknown to satisfy objectLiteralTypeAssertions: "never" rule.
 */
function makeMockResponse(ok: boolean, status: number, body: string): Response {
  const mock = {
    ok,
    status,
    statusText: String(status),
    text: async (): Promise<string> => body
  }
  return (mock as unknown) as Response
}

/** Simulate an inbound webhook call to the registered handler. */
async function callHandler(
  handler: WebhookRoute,
  body: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  const signature = computeSignature(body, TEST_HMAC_SECRET)
  return await handler({
    method: 'POST',
    path: '/webhook/tatum/bitcoin',
    version: '1.1',
    headers: { 'x-tatum-signature': signature, ...headers },
    req: { body } as any
  })
}

/** Call handler without computing a correct signature. */
async function callHandlerRaw(
  handler: WebhookRoute,
  body: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return await handler({
    method: 'POST',
    path: '/webhook/tatum/bitcoin',
    version: '1.1',
    headers,
    req: { body } as any
  })
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('makeTatum plugin', () => {
  let plugin: AddressPlugin
  let mockRegistry: WebhookRegistry
  let registeredHandler: WebhookRoute | null = null
  let createResponses: Response[]
  let deleteResponses: Response[]
  let listResponses: Response[]
  let putResponses: Response[]

  function countCalls(method: string, path: string): number {
    return mockFetch.mock.calls.filter(call => {
      const url = String(call[0])
      const init = call[1]
      const requestMethod = (init?.method ?? 'GET').toUpperCase()
      return requestMethod === method.toUpperCase() && url.includes(path)
    }).length
  }

  /** Mock fetch: createSubscription success */
  function mockSuccessfulCreate(subscriptionId = 'sub-001'): void {
    createResponses.push(
      makeMockResponse(true, 200, JSON.stringify({ id: subscriptionId }))
    )
  }

  /** Mock fetch: deleteSubscription success */
  function mockSuccessfulDelete(): void {
    deleteResponses.push(makeMockResponse(true, 200, ''))
  }

  beforeEach(() => {
    jest.clearAllMocks()

    registeredHandler = null
    createResponses = []
    deleteResponses = []
    listResponses = []
    putResponses = []

    mockFetch.mockImplementation(async (input, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (method === 'GET' && url.includes('/v4/subscription?')) {
        return listResponses.shift() ?? makeMockResponse(true, 200, '[]')
      }
      if (method === 'POST' && url.endsWith('/v4/subscription')) {
        return (
          createResponses.shift() ??
          makeMockResponse(true, 200, JSON.stringify({ id: 'sub-default' }))
        )
      }
      if (method === 'DELETE' && url.includes('/v4/subscription/')) {
        return deleteResponses.shift() ?? makeMockResponse(true, 200, '')
      }
      if (method === 'PUT' && url.includes('/v4/subscription/')) {
        return putResponses.shift() ?? makeMockResponse(true, 204, '')
      }
      return makeMockResponse(
        false,
        500,
        `unexpected request: ${method} ${url}`
      )
    })

    mockRegistry = {
      registerHandler: jest.fn((_key: string, handler: WebhookRoute) => {
        registeredHandler = handler
      }),
      unregisterHandler: jest.fn(),
      handleWebhook: jest.fn(async () => ({ status: 200, body: 'OK' }))
    }

    plugin = makeTatum({
      pluginId: 'bitcoin',
      chain: 'bitcoin-mainnet',
      webhookRegistry: mockRegistry
    })
  })

  afterEach(() => {
    plugin.destroy?.()
    jest.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Instantiation
  // -------------------------------------------------------------------------

  describe('instantiation', () => {
    test('sets pluginId correctly', () => {
      expect(plugin.pluginId).toBe('bitcoin')
    })

    test('registers webhook handler with correct key', () => {
      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        'tatum/bitcoin',
        expect.any(Function)
      )
    })

    test('exposes an on() event emitter', () => {
      expect(typeof plugin.on).toBe('function')
    })
  })

  // -------------------------------------------------------------------------
  // subscribe / unsubscribe
  // -------------------------------------------------------------------------

  describe('subscribe', () => {
    test('returns true on success', async () => {
      mockSuccessfulCreate()
      expect(await plugin.subscribe('0xABC123')).toBe(true)
    })

    test('preserves address case by default', async () => {
      mockSuccessfulCreate()
      await plugin.subscribe('0xABC123')
      // Verify the API was called with original-case address in body
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('0xABC123')
        })
      )
    })

    test('is idempotent — second call skips API', async () => {
      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')
      const result = await plugin.subscribe('0xabc123')
      expect(result).toBe(true)
      expect(countCalls('POST', '/v4/subscription')).toBe(1)
    })

    test('returns false when API call fails after max retries', async () => {
      createResponses = [
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error')
      ]
      const result = await plugin.subscribe('0xfail123')
      expect(result).toBe(false)
    })
  })

  describe('unsubscribe', () => {
    test('returns false for unknown address', async () => {
      expect(await plugin.unsubscribe('0xunknown')).toBe(false)
    })

    test('returns true and calls delete API', async () => {
      mockSuccessfulCreate()
      mockSuccessfulDelete()
      await plugin.subscribe('0xabc123')
      expect(await plugin.unsubscribe('0xabc123')).toBe(true)
    })

    test('removes address from subscriptions', async () => {
      mockSuccessfulCreate()
      mockSuccessfulDelete()
      await plugin.subscribe('0xabc123')
      await plugin.unsubscribe('0xabc123')
      // Second unsubscribe should return false
      expect(await plugin.unsubscribe('0xabc123')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Webhook verification
  // -------------------------------------------------------------------------

  describe('webhook signature verification', () => {
    test('accepts request with valid signature', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')
      const body = buildPayload({ address: '0xabc123' })
      const response = await callHandler(registeredHandler, body)
      expect(response.status).toBe(200)
    })

    test('rejects request with missing signature header', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')
      const body = buildPayload()
      const response = await callHandlerRaw(registeredHandler, body, {})
      expect(response.status).toBe(401)
    })

    test('rejects request with invalid signature', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')
      const body = buildPayload()
      const response = await callHandlerRaw(registeredHandler, body, {
        'x-tatum-signature': 'bad-signature-value'
      })
      expect(response.status).toBe(401)
    })

    test('rejects request with signature for different body', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')
      const correctBody = buildPayload({ address: '0xabc' })
      const tamperedBody = buildPayload({ address: '0xevil' })
      const sig = computeSignature(correctBody, TEST_HMAC_SECRET)
      const response = await callHandlerRaw(registeredHandler, tamperedBody, {
        'x-tatum-signature': sig
      })
      expect(response.status).toBe(401)
    })

    test('rejects malformed JSON payload with 400', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')
      const invalidBody = 'not-valid-json'
      const sig = computeSignature(invalidBody, TEST_HMAC_SECRET)
      const response = await callHandlerRaw(registeredHandler, invalidBody, {
        'x-tatum-signature': sig
      })
      expect(response.status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    test('emits update for first delivery', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      const body = buildPayload({ address: '0xabc123', txId: 'tx-unique-001' })
      const response = await callHandler(registeredHandler, body)

      expect(response.status).toBe(200)
      expect(updateHandler).toHaveBeenCalledTimes(1)
    })

    test('returns 200 but does NOT re-emit for duplicate txId', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      const body = buildPayload({ address: '0xabc123', txId: 'tx-dupe-001' })

      // First delivery
      await callHandler(registeredHandler, body)
      // Duplicate delivery
      const duplicate = await callHandler(registeredHandler, body)

      expect(duplicate.status).toBe(200)
      expect(updateHandler).toHaveBeenCalledTimes(1) // Only once
    })

    test('processes events without txId every time', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      // Payload with no txId — cannot deduplicate, always processes
      const body = buildPayload({ address: '0xabc123', txId: undefined })

      await callHandler(registeredHandler, body)
      await callHandler(registeredHandler, body)

      expect(updateHandler).toHaveBeenCalledTimes(2)
    })

    test('distinct txIds are each processed once', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      for (let i = 0; i < 5; i++) {
        const body = buildPayload({ address: '0xabc123', txId: `tx-${i}` })
        await callHandler(registeredHandler, body)
      }

      expect(updateHandler).toHaveBeenCalledTimes(5)
    })
  })

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  describe('update event emission', () => {
    test('emits update with blockNumber as checkpoint for tracked address', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      const body = buildPayload({
        address: '0xabc123',
        txId: 'tx-block-check',
        blockNumber: 999
      })
      await callHandler(registeredHandler, body)

      expect(updateHandler).toHaveBeenCalledWith({
        address: '0xabc123',
        checkpoint: '999'
      })
    })

    test('emits update with undefined checkpoint when blockNumber missing', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      mockSuccessfulCreate()
      await plugin.subscribe('0xabc123')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      const body = buildPayload({
        address: '0xabc123',
        txId: 'tx-no-block',
        blockNumber: undefined
      })
      await callHandler(registeredHandler, body)

      expect(updateHandler).toHaveBeenCalledWith({
        address: '0xabc123',
        checkpoint: undefined
      })
    })

    test('does NOT emit update for unsubscribed address', async () => {
      if (registeredHandler == null) throw new Error('handler not registered')

      const updateHandler = jest.fn()
      plugin.on('update', updateHandler)

      const body = buildPayload({ address: '0xuntracked', txId: 'tx-xx' })
      await callHandler(registeredHandler, body)

      expect(updateHandler).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Retry / backoff for subscription API calls
  // -------------------------------------------------------------------------

  describe('retry/backoff for API calls', () => {
    test('retries on HTTP 5xx and eventually succeeds', async () => {
      // First two attempts fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce(makeMockResponse(false, 500, 'internal error'))
        .mockResolvedValueOnce(makeMockResponse(false, 503, 'unavailable'))
        .mockResolvedValueOnce(
          makeMockResponse(true, 200, JSON.stringify({ id: 'sub-after-retry' }))
        )

      const result = await plugin.subscribe('0xretry')
      expect(result).toBe(true)
      expect(countCalls('POST', '/v4/subscription')).toBe(3)
    })

    test('retries on HTTP 429 rate limit', async () => {
      mockFetch
        .mockResolvedValueOnce(makeMockResponse(false, 429, 'rate limited'))
        .mockResolvedValueOnce(
          makeMockResponse(true, 200, JSON.stringify({ id: 'sub-after-429' }))
        )

      const result = await plugin.subscribe('0xratelimited')
      expect(result).toBe(true)
      expect(countCalls('POST', '/v4/subscription')).toBe(2)
    })

    test('returns false after MAX_API_RETRIES (5) failures', async () => {
      createResponses = [
        makeMockResponse(false, 500, 'always fails'),
        makeMockResponse(false, 500, 'always fails'),
        makeMockResponse(false, 500, 'always fails'),
        makeMockResponse(false, 500, 'always fails'),
        makeMockResponse(false, 500, 'always fails')
      ]

      const result = await plugin.subscribe('0xalwaysfails')
      expect(result).toBe(false)
      expect(countCalls('POST', '/v4/subscription')).toBe(5)
    })

    test('does not retry on 4xx client errors (non-429)', async () => {
      createResponses = [makeMockResponse(false, 400, 'bad req')]

      const result = await plugin.subscribe('0xbadreq')
      expect(result).toBe(false)
      // Should NOT retry on 400 client errors:
      expect(countCalls('POST', '/v4/subscription')).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Subscription ownership boundary (no cross-server takeover)
  // -------------------------------------------------------------------------

  describe('subscription ownership boundary', () => {
    test('reuses owned existing subscription on 403 exists error', async () => {
      createResponses = [
        makeMockResponse(
          false,
          403,
          JSON.stringify({
            errorCode: 'subscription.exists.on.address-and-currency',
            message: 'Subscription exists'
          })
        )
      ]
      listResponses = [
        makeMockResponse(
          true,
          200,
          JSON.stringify([
            {
              id: 'sub-owned',
              type: 'ADDRESS_EVENT',
              attr: {
                address: '0xowned',
                chain: 'bitcoin-mainnet',
                url: 'https://test.edge.app/webhook/tatum/bitcoin'
              }
            }
          ])
        )
      ]

      const result = await plugin.subscribe('0xowned')
      expect(result).toBe(true)
    })

    test('rejects foreign subscription on 403 exists error', async () => {
      createResponses = [
        makeMockResponse(
          false,
          403,
          JSON.stringify({
            errorCode: 'subscription.exists.on.address-and-currency',
            message: 'Subscription exists'
          })
        )
      ]
      listResponses = [
        makeMockResponse(
          true,
          200,
          JSON.stringify([
            {
              id: 'sub-foreign',
              type: 'ADDRESS_EVENT',
              attr: {
                address: '0xforeign',
                chain: 'bitcoin-mainnet',
                url: 'https://other-server.example.com/webhook/tatum/bitcoin'
              }
            }
          ])
        )
      ]

      const result = await plugin.subscribe('0xforeign')
      expect(result).toBe(false)
      expect(countCalls('PUT', '/v4/subscription/')).toBe(0)
    })

    test('fails when no matching subscription found on 403 exists error', async () => {
      createResponses = [
        makeMockResponse(
          false,
          403,
          JSON.stringify({
            errorCode: 'subscription.exists.on.address-and-currency',
            message: 'Subscription exists'
          })
        )
      ]
      listResponses = [makeMockResponse(true, 200, '[]')]

      const result = await plugin.subscribe('0xghost')
      expect(result).toBe(false)
    })

    test('updates owned subscription URL if stale on 403 exists', async () => {
      createResponses = [
        makeMockResponse(
          false,
          403,
          JSON.stringify({
            errorCode: 'subscription.exists.on.address-and-currency',
            message: 'Subscription exists'
          })
        )
      ]
      listResponses = [
        makeMockResponse(
          true,
          200,
          JSON.stringify([
            {
              id: 'sub-stale',
              type: 'ADDRESS_EVENT',
              attr: {
                address: '0xstale',
                chain: 'bitcoin-mainnet',
                url: 'https://test.edge.app/v1/webhook/tatum/bitcoin'
              }
            }
          ])
        )
      ]
      putResponses = [makeMockResponse(true, 204, '')]

      const result = await plugin.subscribe('0xstale')
      expect(result).toBe(true)
      expect(countCalls('PUT', '/v4/subscription/')).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Delete failure propagation in unsubscribe
  // -------------------------------------------------------------------------

  describe('unsubscribe delete failure propagation', () => {
    test('returns false when remote delete fails with non-retryable error', async () => {
      mockSuccessfulCreate('sub-del-fail')
      await plugin.subscribe('0xdelfail')

      deleteResponses = [makeMockResponse(false, 403, 'forbidden')]

      const result = await plugin.unsubscribe('0xdelfail')
      expect(result).toBe(false)
    })

    test('preserves local subscription state on delete failure', async () => {
      mockSuccessfulCreate('sub-del-fail2')
      await plugin.subscribe('0xdelfail2')

      deleteResponses = [makeMockResponse(false, 403, 'forbidden')]

      await plugin.unsubscribe('0xdelfail2')
      // Address should still be tracked since remote delete failed
      mockSuccessfulDelete()
      const secondResult = await plugin.unsubscribe('0xdelfail2')
      expect(secondResult).toBe(true)
    })

    test('returns false when remote delete exhausts retries', async () => {
      mockSuccessfulCreate('sub-del-retry')
      await plugin.subscribe('0xdelretry')

      deleteResponses = [
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error'),
        makeMockResponse(false, 500, 'error')
      ]

      const result = await plugin.unsubscribe('0xdelretry')
      expect(result).toBe(false)
    })

    test('succeeds and clears state on 404 (already deleted)', async () => {
      mockSuccessfulCreate('sub-del-404')
      await plugin.subscribe('0xdel404')

      deleteResponses = [makeMockResponse(false, 404, 'not found')]

      const result = await plugin.unsubscribe('0xdel404')
      expect(result).toBe(true)
      expect(await plugin.unsubscribe('0xdel404')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // destroy
  // -------------------------------------------------------------------------

  describe('destroy', () => {
    test('unregisters webhook handler', () => {
      plugin.destroy?.()
      expect(mockRegistry.unregisterHandler).toHaveBeenCalledWith(
        'tatum/bitcoin',
        expect.any(Function)
      )
    })

    test('does not delete remote subscriptions on destroy', async () => {
      mockSuccessfulCreate('sub-to-clean')
      await plugin.subscribe('0xclean')

      plugin.destroy?.()

      // Allow microtasks to flush
      await Promise.resolve()
      await Promise.resolve()

      expect(countCalls('DELETE', '/v4/subscription/')).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Chain map tests
// ---------------------------------------------------------------------------

describe('tatumChainMap', () => {
  test('contains exactly 7 entries', () => {
    expect(Object.keys(tatumChainMap)).toHaveLength(7)
  })

  test('TATUM_PLUGIN_IDS matches tatumChainMap keys', () => {
    const mapKeys = Object.keys(tatumChainMap).sort((a, b) =>
      a.localeCompare(b)
    )
    const idsKeys = [...TATUM_PLUGIN_IDS].sort((a, b) => a.localeCompare(b))
    expect(idsKeys).toEqual(mapKeys)
  })

  test.each([
    ['bitcoin', 'bitcoin-mainnet'],
    ['bitcoincash', 'bch-mainnet'],
    ['dogecoin', 'doge-mainnet'],
    ['litecoin', 'litecoin-core-mainnet'],
    ['ripple', 'ripple-mainnet'],
    ['tezos', 'tezos-mainnet'],
    ['tron', 'tron-mainnet']
  ])('maps %s → %s', (pluginId, chain) => {
    expect(tatumChainMap[pluginId]).toBe(chain)
  })

  test('all chain values end with -mainnet', () => {
    for (const chain of Object.values(tatumChainMap)) {
      expect(chain).toMatch(/(mainnet|core-mainnet)$/)
    }
  })
})

// ---------------------------------------------------------------------------
// Integration: webhook → event flow
// ---------------------------------------------------------------------------

describe('integration: webhook → event processing → update emission', () => {
  test('full flow: subscribe → receive webhook → emit update', async () => {
    // NOTE: jest.fn() mock types prevent direct assignment-narrowing inside
    // registerHandler callbacks. Capture via closure instead.
    let capturedHandler: WebhookRoute | null = null

    const webhookRegistry: WebhookRegistry = {
      registerHandler: jest.fn((_key: string, handler: WebhookRoute) => {
        capturedHandler = handler
      }),
      unregisterHandler: jest.fn(),
      handleWebhook: jest.fn(async () => ({ status: 200, body: 'OK' }))
    }

    const mockFetchIntegration = jest.fn<typeof fetch>()
    global.fetch = mockFetchIntegration as typeof fetch
    mockFetchIntegration.mockResolvedValueOnce(
      makeMockResponse(true, 200, '[]')
    )
    mockFetchIntegration.mockResolvedValueOnce(
      makeMockResponse(true, 200, JSON.stringify({ id: 'integration-sub-001' }))
    )

    const p = makeTatum({
      pluginId: 'bitcoin',
      chain: 'bitcoin-mainnet',
      webhookRegistry
    })

    const updateEvents: Array<{ address: string; checkpoint?: string }> = []
    p.on('update', evt => updateEvents.push(evt))

    // Step 1: Subscribe
    const subscribed = await p.subscribe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')
    expect(subscribed).toBe(true)

    // Step 2: Simulate Tatum webhook delivery
    if (capturedHandler == null) throw new Error('Handler not captured')
    const handler = capturedHandler as WebhookRoute

    const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
    const body = JSON.stringify({
      address: testAddress,
      txId: 'btc-tx-123abc',
      blockNumber: 820000,
      type: 'native',
      chain: 'bitcoin-mainnet',
      subscriptionType: 'ADDRESS_EVENT'
    })

    const sig = computeSignature(body, TEST_HMAC_SECRET)
    const response = await handler({
      method: 'POST',
      path: '/webhook/tatum/bitcoin',
      version: '1.1',
      headers: { 'x-tatum-signature': sig },
      req: { body } as any
    })

    // Step 3: Assert
    expect(response.status).toBe(200)
    expect(updateEvents).toHaveLength(1)
    expect(updateEvents[0]).toEqual({
      address: testAddress,
      checkpoint: '820000'
    })

    p.destroy?.()

    // Restore global fetch to the shared mock
    global.fetch = mockFetch as typeof fetch
  })
})
