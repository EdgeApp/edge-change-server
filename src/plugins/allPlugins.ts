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

  //   // Ethereum family:
  makeEvmRpc({
    pluginId: 'abstract',
    url: 'https://api.mainnet.abs.xyz',
    evmScanUrls: ['https://api.abscan.org'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.abstract
  }),
  makeEvmRpc({
    pluginId: 'amoy',
    url: 'https://polygon-amoy-bor-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'arbitrum',
    url: 'https://arbitrum-one-rpc.publicnode.com',
    evmScanUrls: ['https://api.abscan.org'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.arbitrum
  }),
  makeEvmRpc({
    pluginId: 'avalanche',
    url: 'https://avalanche-c-chain-rpc.publicnode.com',
    evmScanUrls: [
      'https://api.avascan.info/v2/network/mainnet/evm/43114/etherscan',
      'https://api.snowscan.xyz'
    ],
    evmScanApiKeys: serverConfig.evmScanApiKeys.avalanche
  }),
  makeEvmRpc({
    pluginId: 'base',
    url: 'https://base-rpc.publicnode.com',
    evmScanUrls: ['https://api.basescan.org'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.base
  }),
  makeEvmRpc({
    pluginId: 'binancesmartchain',
    url: 'https://bsc-rpc.publicnode.com',
    evmScanUrls: ['https://api.bscscan.com'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.binancesmartchain
  }),
  makeEvmRpc({
    pluginId: 'bobevm',
    url: 'https://bob.drpc.org',
    evmScanUrls: ['https://explorer.gobob.xyz'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.bobevm
  }),
  makeEvmRpc({
    pluginId: 'celo',
    url: 'https://celo-rpc.publicnode.com',
    evmScanUrls: ['https://explorer.celo.org/mainnet'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.celo
  }),
  makeEvmRpc({
    pluginId: 'ethereum',
    url: 'https://ethereum-rpc.publicnode.com',
    evmScanUrls: ['https://api.etherscan.io', 'https://eth.blockscout.com/'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.ethereum
  }),
  makeEvmRpc({
    pluginId: 'ethereumclassic',
    url: 'https://geth-at.etc-network.info',
    evmScanUrls: ['https://etc.blockscout.com'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.ethereumclassic
  }),
  makeEvmRpc({
    pluginId: 'ethereumpow',
    url: 'https://mainnet.ethereumpow.org',
    evmScanUrls: ['https://etc.blockscout.com/'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.ethereumpow
  }),
  makeEvmRpc({
    pluginId: 'fantom',
    url: 'https://rpc.fantom.network',
    evmScanUrls: ['https://ftmscout.com/'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.fantom
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
    evmScanUrls: ['https://api-holesky.etherscan.io'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.holesky
  }),
  makeEvmRpc({
    pluginId: 'optimism',
    url: 'https://optimism-rpc.publicnode.com',
    evmScanUrls: ['https://api-optimistic.etherscan.io'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.optimism
  }),
  makeEvmRpc({
    pluginId: 'polygon',
    url: 'https://polygon-bor-rpc.publicnode.com',
    evmScanUrls: ['https://api.polygonscan.com'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.polygon
  }),
  makeEvmRpc({
    pluginId: 'pulsechain',
    url: 'https://pulsechain-rpc.publicnode.com',
    evmScanUrls: ['https://api.scan.pulsechain.com'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.pulsechain
  }),
  makeEvmRpc({
    pluginId: 'rsk',
    url: 'https://public-node.rsk.co',
    evmScanUrls: ['https://rootstock.blockscout.com/'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.rsk
  }),
  makeEvmRpc({
    pluginId: 'sepolia',
    url: 'https://ethereum-sepolia-rpc.publicnode.com',
    evmScanUrls: ['https://api-sepolia.etherscan.io'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.sepolia
  }),
  makeEvmRpc({
    pluginId: 'sonic',
    url: 'https://sonic.drpc.org',
    evmScanUrls: ['https://api.sonicscan.org'],
    evmScanApiKeys: serverConfig.evmScanApiKeys.sonic
  }),
  makeEvmRpc({
    pluginId: 'zksync',
    url: 'https://1rpc.io/zksync2-era',
    evmScanUrls: [
      'https://block-explorer-api.mainnet.zksync.io',
      'https://api-era.zksync.network',
      'https://zksync.blockscout.com/api'
    ],
    evmScanApiKeys: serverConfig.evmScanApiKeys.zksync
  }),

  // Testing:
  makeFakePlugin()
]
