import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals'

import { Logger } from '../../src/util/logger'
import { makeEtherscanV2ScanAdapter } from '../../src/util/scanAdapters/EtherscanV2ScanAdapter'
import { mswServer } from '../util/mswServer'

describe('EtherscanV2ScanAdapter', function () {
  const TEST_ETH_ADDRESS = '0xF5335367A46c2484f13abd051444E39775EA7b60'
  const TEST_ETH_ADDRESS_INTERNAL = '0x036639F209f2Ebcde65a3f7896d05a4941d20373'

  const ADDRESS_WITH_TOKEN_TRANSACTION =
    '0xA83b24b53e18D6B86db860F1d3B19A1300CCFbcE'

  // tx hash: 0x6a3d9907cca3bf99f56da2352a50498d5467cdcc9e9e8e4fbd4e84cde7f411a3
  const TOKEN_TRANSACTION_HEIGHT = 22499360

  // Mock logger for testing
  const mockLog = jest.fn()
  const logger: Logger = Object.assign(mockLog, {
    warn: jest.fn(),
    error: jest.fn()
  })

  const adapter = makeEtherscanV2ScanAdapter(
    {
      type: 'etherscan-v2',
      chainId: 1,
      urls: ['https://api.etherscan.io']
    },
    logger
  )

  beforeAll(() => {
    mswServer.listen()
  })
  afterAll(() => {
    mswServer.close()
  })

  it('should return true if checkpoint is undefined', async function () {
    const result = await adapter(TEST_ETH_ADDRESS)
    expect(result).toBe(true)
  })

  it('should return true if checkpoint is behind the latest transaction', async function () {
    const result = await adapter(TEST_ETH_ADDRESS, '12345')
    expect(result).toBe(true)
  })

  it('should return false if checkpoint is ahead of the latest transaction', async function () {
    const result = await adapter(TEST_ETH_ADDRESS, '1234567890')
    expect(result).toBe(false)
  })

  it('should return true if checkpoint is behind token transaction', async function () {
    const result = await adapter(
      ADDRESS_WITH_TOKEN_TRANSACTION,
      (TOKEN_TRANSACTION_HEIGHT - 1).toString()
    )
    expect(result).toBe(true)
  })

  it('should return false if checkpoint is ahead of token transaction', async function () {
    const result = await adapter(
      ADDRESS_WITH_TOKEN_TRANSACTION,
      (TOKEN_TRANSACTION_HEIGHT + 1).toString()
    )
    expect(result).toBe(false)
  })

  it('should return true if checkpoint is behind an internal transaction', async function () {
    const result = await adapter(TEST_ETH_ADDRESS_INTERNAL, '23642875')
    expect(result).toBe(true)
  })

  it('should return false if checkpoint is ahead of the latest internal transaction', async function () {
    const result = await adapter(TEST_ETH_ADDRESS_INTERNAL, '23643125')
    expect(result).toBe(false)
  })
})
