/**
 * Standalone script to check if addresses have any transaction history
 * on various EVM chains using Etherscan-compatible APIs.
 *
 * Run with: npx ts-node test/v2/checkAddressStatus.ts
 */

interface ChainConfig {
  pluginId: string
  name: string
  apiUrl: string
  chainId?: number // For etherscan v2 API
}

const TEST_ADDRESSES = [
  '0x62Ed0197171174e03C2e1BA20299BAC8aF14bF10',
  '0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9'
]

// Chains and their block explorer APIs
const chains: ChainConfig[] = [
  {
    pluginId: 'ethereum',
    name: 'Ethereum',
    apiUrl: 'https://api.etherscan.io/api',
    chainId: 1
  },
  {
    pluginId: 'polygon',
    name: 'Polygon',
    apiUrl: 'https://api.polygonscan.com/api'
  },
  {
    pluginId: 'avalanche',
    name: 'Avalanche',
    apiUrl: 'https://api.snowtrace.io/api'
  },
  {
    pluginId: 'binancesmartchain',
    name: 'BSC',
    apiUrl: 'https://api.bscscan.com/api'
  },
  {
    pluginId: 'optimism',
    name: 'Optimism',
    apiUrl: 'https://api-optimistic.etherscan.io/api'
  },
  {
    pluginId: 'zksync',
    name: 'zkSync',
    apiUrl: 'https://block-explorer-api.mainnet.zksync.io/api'
  }
]

interface TxListResponse {
  status: string
  message: string
  result: any[]
}

async function checkAddressOnChain(
  chain: ChainConfig,
  address: string
): Promise<{ hasTxs: boolean; txCount: number }> {
  try {
    const url = `${chain.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1&sort=desc`
    const response = await fetch(url)
    const data = (await response.json()) as TxListResponse

    if (data.status === '1' && Array.isArray(data.result)) {
      return { hasTxs: data.result.length > 0, txCount: data.result.length }
    }
    return { hasTxs: false, txCount: 0 }
  } catch (error) {
    console.error(`Error checking ${chain.name}: ${String(error)}`)
    return { hasTxs: false, txCount: 0 }
  }
}

async function main(): Promise<void> {
  console.log('Checking address status on various chains...\n')
  console.log(
    'Expected subscription result codes:\n' +
      '  -1 = Not supported\n' +
      '   0 = Failed (error)\n' +
      '   1 = Subscribed, no changes (address has no recent activity)\n' +
      '   2 = Subscribed, changes present (address has activity)\n'
  )

  const results: Record<
    string,
    Record<string, { hasTxs: boolean; expectedResult: number }>
  > = {}

  for (const address of TEST_ADDRESSES) {
    results[address] = {}
    console.log(`\n=== Address: ${address} ===\n`)

    for (const chain of chains) {
      const { hasTxs } = await checkAddressOnChain(chain, address)
      // If checking at checkpoint 0, hasTxs means there are changes since "the beginning"
      // Result 2 = changes present, Result 1 = no changes
      const expectedResult = hasTxs ? 2 : 1

      results[address][chain.pluginId] = { hasTxs, expectedResult }

      console.log(
        `  ${chain.name.padEnd(15)} (${chain.pluginId.padEnd(20)}): ` +
          `${hasTxs ? 'HAS TRANSACTIONS' : 'NO TRANSACTIONS'} ` +
          `-> Expected result: ${expectedResult}`
      )

      // Rate limit to avoid API throttling
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  console.log('\n\n=== Summary for Tests ===\n')
  console.log('export const EXPECTED_RESULTS = {')
  for (const address of TEST_ADDRESSES) {
    console.log(`  '${address}': {`)
    for (const [pluginId, data] of Object.entries(results[address])) {
      console.log(`    '${pluginId}': ${data.expectedResult},`)
    }
    console.log('  },')
  }
  console.log('}')
}

main().catch(console.error)
