import { serverConfig } from '../serverConfig'
import { AddressPlugin } from '../types/addressPlugin'
import { BlockbookOptions, makeBlockbook } from './blockbook'
import { makeEvmRpc } from './evmRpc'
import { makeFakePlugin } from './fakePlugin'

function makeNowNode(opts: BlockbookOptions): AddressPlugin {
  return makeBlockbook({
    ...opts,
    safeUrl: opts.url,
    url: opts.url + '/' + serverConfig.nowNodesApiKey
  })
}

export const allPlugins = [
  // Bitcoin family:
  makeNowNode({
    pluginId: 'bitcoin',
    url: 'wss://btcbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'bitcoincash',
    url: 'wss://bchbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'dogecoin',
    url: 'wss://dogebook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'litecoin',
    url: 'wss://ltcbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'qtum',
    url: 'wss://qtum-blockbook.nownodes.io/wss'
  }),

  // Ethereum family:
  makeEvmRpc({
    pluginId: 'abstract',
    url: 'https://api.mainnet.abs.xyz',
    scanAdapters: [{ type: 'etherscan-v1', urls: ['https://api.abscan.org'] }]
  }),
  makeEvmRpc({
    pluginId: 'amoy',
    url: 'https://polygon-amoy-bor-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'arbitrum',
    url: 'https://arbitrum-one-rpc.publicnode.com',
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: ['https://api.etherscan.io', 'https://api.arbiscan.io']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'avalanche',
    url: 'https://avalanche-c-chain-rpc.publicnode.com',
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: [
          'https://api.avascan.info/v2/network/mainnet/evm/43114/etherscan',
          'https://api.snowscan.xyz'
        ]
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'base',
    url: 'https://base-rpc.publicnode.com',
    scanAdapters: [{ type: 'etherscan-v1', urls: ['https://api.basescan.org'] }]
  }),
  makeEvmRpc({
    pluginId: 'binancesmartchain',
    url: 'https://bsc-rpc.publicnode.com',
    scanAdapters: [{ type: 'etherscan-v1', urls: ['https://api.bscscan.com'] }]
  }),
  makeEvmRpc({
    pluginId: 'bobevm',
    url: 'https://bob.drpc.org',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://explorer.gobob.xyz'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'celo',
    url: 'https://celo-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://explorer.celo.org/mainnet'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'ethereum',
    url: 'https://ethereum-rpc.publicnode.com',
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: ['https://api.etherscan.io', 'https://eth.blockscout.com/']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'ethereumclassic',
    url: 'https://geth-at.etc-network.info',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://etc.blockscout.com'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'ethereumpow',
    url: 'https://mainnet.ethereumpow.org'
  }),
  makeEvmRpc({
    pluginId: 'fantom',
    url: 'https://rpc.fantom.network',
    scanAdapters: [{ type: 'etherscan-v1', urls: ['https://ftmscout.com/'] }]
  }),
  makeEvmRpc({
    pluginId: 'filecoinfevm',
    url: 'https://rpc.ankr.com/filecoin'
  }),
  makeEvmRpc({
    pluginId: 'filecoinfevmcalibration',
    url: 'https://rpc.ankr.com/filecoin_testnet'
  }),
  makeEvmRpc({
    pluginId: 'holesky',
    url: 'https://ethereum-holesky-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api-holesky.etherscan.io'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'optimism',
    url: 'https://optimism-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api-optimistic.etherscan.io'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'polygon',
    url: 'https://polygon-bor-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api.polygonscan.com'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'pulsechain',
    url: 'https://pulsechain-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api.scan.pulsechain.com'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'rsk',
    url: 'https://public-node.rsk.co',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://rootstock.blockscout.com/'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'sepolia',
    url: 'https://ethereum-sepolia-rpc.publicnode.com',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api-sepolia.etherscan.io'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'sonic',
    url: 'https://sonic.drpc.org',
    scanAdapters: [
      { type: 'etherscan-v1', urls: ['https://api.sonicscan.org'] }
    ]
  }),
  makeEvmRpc({
    pluginId: 'zksync',
    url: 'https://1rpc.io/zksync2-era',
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: [
          'https://block-explorer-api.mainnet.zksync.io',
          'https://api-era.zksync.network',
          'https://zksync.blockscout.com/api'
        ]
      }
    ]
  }),

  // Testing:
  makeFakePlugin()
]
