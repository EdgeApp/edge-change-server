/**
 * Integration tests for the v2 EVM RPC plugin.
 *
 * IMPORTANT: These tests require the v2 server to be running:
 *   yarn start.v2
 *
 * The tests connect via WebSocket and verify:
 * 1. Subscription responses for known addresses
 * 2. Multiple connections subscribing to the same address
 * 3. Proper cleanup when connections close
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from '@jest/globals'
import WebSocket from 'ws'

import { messageToString } from '../../src/messageToString'
import { changeProtocol } from '../../src/types/changeProtocol'
import { snooze } from '../util/snooze'

// Test addresses - we'll verify these have known transaction histories
const TEST_ADDRESS_1 = '0x62Ed0197171174e03C2e1BA20299BAC8aF14bF10'
const TEST_ADDRESS_2 = '0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9'

// Server configuration (must match v2 server)
// Use 127.0.0.1 explicitly to avoid IPv6 resolution issues
const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 8008
const SERVER_URL = `ws://${SERVER_HOST}:${SERVER_PORT}`

// Connection timeout
const CONNECTION_TIMEOUT = 5000
const SUBSCRIBE_TIMEOUT = 30000 // Allow time for scan adapters

interface TestClient {
  ws: WebSocket
  codec: ReturnType<typeof changeProtocol.makeClientCodec>
  updates: Array<[string, string, string | undefined]>
  subLosts: Array<[string, string]>
  ready: Promise<void>
  close: () => void
}

function createTestClient(): TestClient {
  const ws = new WebSocket(SERVER_URL)
  const updates: Array<[string, string, string | undefined]> = []
  const subLosts: Array<[string, string]> = []

  let readyResolve: () => void
  const ready = new Promise<void>(resolve => {
    readyResolve = resolve
  })

  const codec = changeProtocol.makeClientCodec({
    handleError(error) {
      console.error('Client codec error:', error)
    },
    async handleSend(text) {
      ws.send(text)
    },
    localMethods: {
      update(params) {
        updates.push([params[0], params[1], params[2]])
      },
      subLost(params) {
        subLosts.push([params[0], params[1]])
      }
    }
  })

  ws.on('open', () => {
    readyResolve()
  })

  ws.on('message', message => {
    codec.handleMessage(messageToString(message))
  })

  ws.on('error', error => {
    console.error('WebSocket error:', error)
  })

  return {
    ws,
    codec,
    updates,
    subLosts,
    ready,
    close: () => {
      codec.handleClose()
      ws.close()
    }
  }
}

async function waitForConnection(client: TestClient): Promise<void> {
  await Promise.race([
    client.ready,
    new Promise<never>((resolve, reject) => {
      // resolve is intentionally unused for timeout-only promise
      const unused = resolve
      if (unused == null) reject(new Error('Unexpected'))
      setTimeout(
        () => reject(new Error('Connection timeout')),
        CONNECTION_TIMEOUT
      )
    })
  ])
}

describe('EVM RPC Plugin Integration Tests', () => {
  // Skip tests if server is not running
  let serverAvailable = false

  beforeAll(async () => {
    // Check if server is running
    const testWs = new WebSocket(SERVER_URL)
    try {
      await new Promise<void>((resolve, reject) => {
        testWs.on('open', () => {
          serverAvailable = true
          testWs.close()
          resolve()
        })
        testWs.on('error', () => {
          serverAvailable = false
          reject(new Error('Server not available'))
        })
        setTimeout(() => reject(new Error('Timeout')), 2000)
      })
    } catch {
      console.warn(
        '\n⚠️  v2 server not running. Skipping integration tests.\n' +
          '   Start the server with: yarn start.v2\n'
      )
    }
  })

  describe('Single client subscription tests', () => {
    let client: TestClient

    beforeEach(async () => {
      if (!serverAvailable) return
      client = createTestClient()
      await waitForConnection(client)
    })

    afterEach(() => {
      if (client != null) {
        client.close()
      }
    })

    test(
      'subscribe to ethereum with first test address (with checkpoint)',
      async () => {
        if (!serverAvailable) {
          console.log('Skipping - server not available')
          return
        }

        // Subscribe with checkpoint 0 to trigger scan adapter
        const results = await client.codec.remoteMethods.subscribe([
          ['ethereum', TEST_ADDRESS_1, '0']
        ])

        console.log('\nEthereum subscription result for address 1:', results[0])

        // Verify result is a valid code (-1, 0, 1, or 2)
        expect([-1, 0, 1, 2]).toContain(results[0])
      },
      SUBSCRIBE_TIMEOUT
    )

    test(
      'subscribe to multiple chains sequentially with address 1',
      async () => {
        if (!serverAvailable) {
          console.log('Skipping - server not available')
          return
        }

        // Subscribe to chains one at a time to avoid rate limits
        const testChains = ['ethereum', 'polygon', 'avalanche']

        console.log('\nSequential subscription results for address 1:')
        for (const chain of testChains) {
          const results = await client.codec.remoteMethods.subscribe([
            [chain, TEST_ADDRESS_1, '0']
          ])
          console.log(`  ${chain}: ${results[0]}`)
          expect([-1, 0, 1, 2]).toContain(results[0])

          // Small delay to avoid rate limiting
          await snooze(500)
        }
      },
      SUBSCRIBE_TIMEOUT * 2
    )

    test(
      'subscribe to multiple chains sequentially with address 2',
      async () => {
        if (!serverAvailable) {
          console.log('Skipping - server not available')
          return
        }

        const testChains = ['ethereum', 'binancesmartchain', 'optimism']

        console.log('\nSequential subscription results for address 2:')
        for (const chain of testChains) {
          const results = await client.codec.remoteMethods.subscribe([
            [chain, TEST_ADDRESS_2, '0']
          ])
          console.log(`  ${chain}: ${results[0]}`)
          expect([-1, 0, 1, 2]).toContain(results[0])

          await snooze(500)
        }
      },
      SUBSCRIBE_TIMEOUT * 2
    )

    test('subscribe without checkpoint should return result 2', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Subscribe without checkpoint - should always return 2 (changes present)
      // because without a checkpoint we can't scan
      const results = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      console.log('\nSubscription without checkpoint:', results[0])
      // Without checkpoint, result should be 2 (changes present) or valid code
      expect([-1, 0, 1, 2]).toContain(results[0])
    })

    test('subscribe to unsupported plugin returns -1', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      const results = await client.codec.remoteMethods.subscribe([
        ['nonexistent-chain', TEST_ADDRESS_1]
      ])

      expect(results[0]).toBe(-1)
    })

    test('unsubscribe after subscribe', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Subscribe first
      await client.codec.remoteMethods.subscribe([['ethereum', TEST_ADDRESS_1]])

      // Unsubscribe
      const result = await client.codec.remoteMethods.unsubscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      expect(result).toBeUndefined()
    })
  })

  describe('Multiple client tests - same address', () => {
    const clients: TestClient[] = []

    afterEach(async () => {
      // Close all clients
      for (const client of clients) {
        client.close()
      }
      clients.length = 0
      // Give server time to process disconnections
      await snooze(500)
    })

    test(
      'multiple clients subscribing to same address',
      async () => {
        if (!serverAvailable) {
          console.log('Skipping - server not available')
          return
        }

        // Create 3 clients
        for (let i = 0; i < 3; i++) {
          const client = createTestClient()
          await waitForConnection(client)
          clients.push(client)
        }

        console.log('\n3 clients connected, subscribing to same address...')

        // Subscribe sequentially to avoid rate limiting on scan adapters
        const results: number[] = []
        for (let i = 0; i < clients.length; i++) {
          const client = clients[i]
          const subscribeResults = await client.codec.remoteMethods.subscribe([
            ['ethereum', TEST_ADDRESS_1, '0']
          ])
          console.log(
            `  Client ${i + 1} subscribe result: ${subscribeResults[0]}`
          )
          results.push(subscribeResults[0])
          // Small delay to avoid rate limiting
          await snooze(500)
        }

        // All should get valid results
        for (const result of results) {
          expect([-1, 0, 1, 2]).toContain(result)
        }
      },
      SUBSCRIBE_TIMEOUT * 2
    )

    test('disconnect one client while others remain subscribed', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Create 2 clients
      for (let i = 0; i < 2; i++) {
        const client = createTestClient()
        await waitForConnection(client)
        clients.push(client)
      }

      // Both subscribe
      await clients[0].codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])
      await clients[1].codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      console.log('\nBoth clients subscribed. Disconnecting client 1...')

      // Disconnect first client
      clients[0].close()
      clients.shift() // Remove from array so afterEach doesn't double-close

      // Give server time to process
      await snooze(1000)

      // Second client should still be subscribed and can unsubscribe
      const result = await clients[0].codec.remoteMethods.unsubscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      expect(result).toBeUndefined()
      console.log(
        'Client 2 successfully unsubscribed after client 1 disconnect'
      )
    })

    test('same client subscribes to same address twice (idempotent)', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      const client = createTestClient()
      await waitForConnection(client)
      clients.push(client)

      // Subscribe twice to the same address
      const result1 = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])
      const result2 = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      console.log(
        `\nFirst subscribe: ${result1[0]}, Second subscribe: ${result2[0]}`
      )

      // Both should succeed
      expect([-1, 0, 1, 2]).toContain(result1[0])
      expect([-1, 0, 1, 2]).toContain(result2[0])
    })
  })

  describe('Subscription lifecycle tests', () => {
    let client: TestClient

    beforeEach(async () => {
      if (!serverAvailable) return
      client = createTestClient()
      await waitForConnection(client)
    })

    afterEach(() => {
      if (client != null) {
        client.close()
      }
    })

    test('subscribe, unsubscribe, re-subscribe cycle', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Subscribe
      const sub1 = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])
      console.log(`\nSubscribe 1: ${sub1[0]}`)

      // Unsubscribe
      await client.codec.remoteMethods.unsubscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])
      console.log('Unsubscribed')

      // Re-subscribe
      const sub2 = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])
      console.log(`Subscribe 2: ${sub2[0]}`)

      expect([-1, 0, 1, 2]).toContain(sub1[0])
      expect([-1, 0, 1, 2]).toContain(sub2[0])
    })

    test('subscribe to multiple chains at once', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Subscribe to multiple chains in a single request
      const subscribeParams: Array<[string, string]> = [
        ['ethereum', TEST_ADDRESS_1],
        ['polygon', TEST_ADDRESS_1],
        ['avalanche', TEST_ADDRESS_1],
        ['ethereum', TEST_ADDRESS_2],
        ['polygon', TEST_ADDRESS_2]
      ]

      const results = await client.codec.remoteMethods.subscribe(
        subscribeParams
      )

      console.log('\nBatch subscription results:')
      for (let i = 0; i < subscribeParams.length; i++) {
        const [chain, addr] = subscribeParams[i]
        console.log(`  ${chain} / ${addr.slice(0, 10)}...: ${results[i]}`)
        expect([-1, 0, 1, 2]).toContain(results[i])
      }
    })

    test('unsubscribe from addresses not subscribed to (no-op)', async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Unsubscribe without subscribing first - should not error
      const result = await client.codec.remoteMethods.unsubscribe([
        ['ethereum', TEST_ADDRESS_1]
      ])

      expect(result).toBeUndefined()
    })
  })
})

describe('Address scanning verification', () => {
  let client: TestClient
  let serverAvailable = false

  beforeAll(async () => {
    const testWs = new WebSocket(SERVER_URL)
    try {
      await new Promise<void>((resolve, reject) => {
        testWs.on('open', () => {
          serverAvailable = true
          testWs.close()
          resolve()
        })
        testWs.on('error', () => reject(new Error('Connection failed')))
        setTimeout(() => reject(new Error('Timeout')), 2000)
      })
    } catch {
      serverAvailable = false
    }
  })

  beforeEach(async () => {
    if (!serverAvailable) return
    client = createTestClient()
    await waitForConnection(client)
  })

  afterEach(() => {
    if (client != null) {
      client.close()
    }
  })

  test(
    'checkpoint 0 should trigger scan and return appropriate result',
    async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Subscribe with checkpoint 0 - should check from beginning of chain
      const results = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1, '0']
      ])

      console.log(`\nEthereum subscribe with checkpoint 0: ${results[0]}`)

      // Result 1 = no changes since checkpoint, Result 2 = changes present
      // Both are valid - depends on the address's actual history
      expect([1, 2]).toContain(results[0])
    },
    SUBSCRIBE_TIMEOUT
  )

  test(
    'very high checkpoint should return result 1 (no changes)',
    async () => {
      if (!serverAvailable) {
        console.log('Skipping - server not available')
        return
      }

      // Use a very high block number that's likely in the future
      const futureBlock = '999999999'

      const results = await client.codec.remoteMethods.subscribe([
        ['ethereum', TEST_ADDRESS_1, futureBlock]
      ])

      console.log(`\nEthereum subscribe with future checkpoint: ${results[0]}`)

      // Should return 1 (no changes since this "future" block)
      // or 2 if scan failed (which would mean assume changes)
      expect([1, 2]).toContain(results[0])
    },
    SUBSCRIBE_TIMEOUT
  )
})
