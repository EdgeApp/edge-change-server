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
    url: 'https://api.mainnet.abs.xyz'
  }),
  makeEvmRpc({
    pluginId: 'amoy',
    url: 'https://polygon-amoy-bor-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'arbitrum',
    url: 'https://arbitrum-one-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'avalanche',
    url: 'https://avalanche-c-chain-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'base',
    url: 'https://base-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'binancesmartchain',
    url: 'https://bsc-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'bobevm',
    url: 'https://bob.drpc.org'
  }),
  makeEvmRpc({
    pluginId: 'celo',
    url: 'https://celo-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'ethereum',
    url: 'https://ethereum-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'ethereumclassic',
    url: 'https://geth-at.etc-network.info'
  }),
  makeEvmRpc({
    pluginId: 'ethereumpow',
    url: 'https://mainnet.ethereumpow.org'
  }),
  makeEvmRpc({
    pluginId: 'fantom',
    url: 'https://rpc.fantom.network'
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
    url: 'https://ethereum-holesky-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'optimism',
    url: 'https://optimism-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'polygon',
    url: 'https://polygon-bor-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'pulsechain',
    url: 'https://pulsechain-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'rsk',
    url: 'https://public-node.rsk.co'
  }),
  makeEvmRpc({
    pluginId: 'sepolia',
    url: 'https://ethereum-sepolia-rpc.publicnode.com'
  }),
  makeEvmRpc({
    pluginId: 'sonic',
    url: 'https://sonic.drpc.org'
  }),
  makeEvmRpc({
    pluginId: 'zksync',
    url: 'https://1rpc.io/zksync2-era'
  }),

  // Testing:
  makeFakePlugin()
]
