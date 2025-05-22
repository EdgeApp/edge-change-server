import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals'

import { Logger } from '../../src/types'
import { makeEtherscanV1ScanAdapter } from '../../src/util/scanAdapters/EtherscanV1ScanAdapter'
import { mswServer } from '../util/mswServer'

describe('EtherscanV1ScanAdapter', function () {
  const TEST_ETH_ADDRESS = '0xF5335367A46c2484f13abd051444E39775EA7b60'

  // Mock logger for testing
  const logger: Logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }

  const adapter = makeEtherscanV1ScanAdapter(
    {
      type: 'etherscan-v1',
      urls: ['https://eth.blockscout.com']
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
})
