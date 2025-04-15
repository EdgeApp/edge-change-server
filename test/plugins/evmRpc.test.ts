import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from '@jest/globals'

import { makeEvmRpc } from '../../src/plugins/evmRpc'
import { AddressPlugin } from '../../src/types/addressPlugin'

// Mock viem
jest.mock('viem', () => {
  // Mock functions and data
  const mockWatchBlocks = jest.fn()
  const mockGetLogs = jest.fn()

  const mockClient = {
    watchBlocks: mockWatchBlocks,
    getLogs: mockGetLogs
  }

  return {
    createPublicClient: jest.fn(() => mockClient),
    http: jest.fn(url => ({ url })),
    parseAbiItem: jest.fn(abiString => ({ abiString }))
  }
})

jest.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Mainnet' }
}))

// Access the mocked client - Using any type to avoid TS errors with Jest mocks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockViemLib: any = jest.requireMock('viem')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClient: any = mockViemLib.createPublicClient()

describe('evmRpc plugin', function () {
  const TEST_ETH_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
  const TEST_ETH_ADDRESS_LOWERCASE = TEST_ETH_ADDRESS.toLowerCase()
  const TEST_SECOND_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F' // DAI
  const TEST_SECOND_ADDRESS_LOWERCASE = TEST_SECOND_ADDRESS.toLowerCase()

  const mockUrl = 'https://ethereum.example.com/rpc'

  const consoleSpy = {
    log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {})
  }

  let plugin: AddressPlugin

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset mock functions
    mockClient.watchBlocks.mockImplementation(
      ({ onBlock }: { onBlock: any }) => {
        // Store the callback to trigger it later in tests
        mockClient.watchBlocks.onBlock = onBlock
        return { unwatch: jest.fn() }
      }
    )

    mockClient.getLogs.mockResolvedValue([])

    plugin = makeEvmRpc({
      pluginId: 'test-evm',
      url: mockUrl
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('plugin instantiation', function () {
    expect(plugin.pluginId).toBe('test-evm')
    expect(mockViemLib.createPublicClient).toHaveBeenCalledWith({
      chain: expect.anything(),
      transport: expect.anything()
    })
    expect(mockClient.watchBlocks).toHaveBeenCalled()
  })

  test('subscribe should return true', async function () {
    const result = await plugin.subscribe(TEST_ETH_ADDRESS)
    expect(result).toBe(true)
  })

  test('address normalization during subscription', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)

    // Simulate a block with a transaction from our address (in different case)
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: TEST_ETH_ADDRESS_LOWERCASE,
          to: '0xdef'
        }
      ]
    }

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    // Check that our handler was called with the original address case
    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('unsubscribe should remove address', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)
    const result = await plugin.unsubscribe(TEST_ETH_ADDRESS)
    expect(result).toBe(true)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with a transaction from our address
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: TEST_ETH_ADDRESS_LOWERCASE,
          to: '0xdef'
        }
      ]
    }

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    // Check that our handler was NOT called because we unsubscribed
    expect(updateHandler).not.toHaveBeenCalled()
  })

  test('update event should fire for sender address', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with a transaction from our address
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: TEST_ETH_ADDRESS_LOWERCASE,
          to: '0xdef'
        }
      ]
    }

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('update event should fire for recipient address', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with a transaction to our address
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: '0xdef',
          to: TEST_ETH_ADDRESS_LOWERCASE
        }
      ]
    }

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('update event should fire for ERC20 transfer events', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with no direct transactions for our address
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: '0xaaa',
          to: '0xbbb'
        }
      ]
    }

    // Mock an ERC20 transfer log where our address is the sender
    mockClient.getLogs.mockResolvedValueOnce([
      {
        args: {
          from: TEST_ETH_ADDRESS_LOWERCASE,
          to: '0xccc',
          value: 1000000000000000000n
        }
      }
    ])

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    expect(mockClient.getLogs).toHaveBeenCalledWith({
      blockHash: '0xabc',
      event: expect.anything()
    })

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('update event should fire for ERC20 token received', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with no direct transactions for our address
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: '0xaaa',
          to: '0xbbb'
        }
      ]
    }

    // Mock an ERC20 transfer log where our address is the recipient
    mockClient.getLogs.mockResolvedValueOnce([
      {
        args: {
          from: '0xccc',
          to: TEST_ETH_ADDRESS_LOWERCASE,
          value: 1000000000000000000n
        }
      }
    ])

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('multiple subscribed addresses should all receive updates', async function () {
    await plugin.subscribe(TEST_ETH_ADDRESS)
    await plugin.subscribe(TEST_SECOND_ADDRESS)

    // Set up event handler
    const updateHandler = jest.fn()
    plugin.on('update', updateHandler)

    // Simulate a block with transactions for both addresses
    const mockBlock = {
      number: 123456n,
      hash: '0xabc',
      transactions: [
        {
          from: TEST_ETH_ADDRESS_LOWERCASE,
          to: TEST_SECOND_ADDRESS_LOWERCASE
        }
      ]
    }

    // Trigger block callback
    await mockClient.watchBlocks.onBlock(mockBlock)

    // Both addresses should receive updates
    expect(updateHandler).toHaveBeenCalledTimes(2)
    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_ETH_ADDRESS,
      checkpoint: '123456'
    })
    expect(updateHandler).toHaveBeenCalledWith({
      address: TEST_SECOND_ADDRESS,
      checkpoint: '123456'
    })
  })

  test('scanAddress should return true', async function () {
    if (plugin.scanAddress == null) {
      return
    }

    // Subscribe first to make sure the address is tracked
    await plugin.subscribe(TEST_ETH_ADDRESS)

    const result = await plugin.scanAddress(TEST_ETH_ADDRESS)
    expect(result).toBe(true)
  })

  test('watchBlocks error handler should log errors', async function () {
    // Get the error handler that was passed to watchBlocks
    const errorHandler = mockClient.watchBlocks.mock.calls[0][0].onError

    // Call the error handler
    errorHandler(new Error('Test error'))

    // Check that the error was logged
    expect(consoleSpy.error).toHaveBeenCalledWith(
      'test-evm (https://ethereum.example.com/rpc):',
      'watchBlocks error',
      expect.any(Error)
    )
  })
})
