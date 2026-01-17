import { serverConfig } from '../serverConfig'
import { AddressPlugin } from '../types/addressPlugin'
import { BlockbookOptions, makeBlockbook } from './blockbook'
import { makeEvmRpc } from './evmRpc'
import { makeFakePlugin } from './fakePlugin'

function makeNowNode(opts: BlockbookOptions): AddressPlugin {
  return makeBlockbook({
    ...opts,
    nowNodesApiKey: serverConfig.nowNodesApiKey
  })
}

export const allPlugins = [
  // Bitcoin family:
  makeNowNode({
    pluginId: 'bitcoin',
    url: 'wss://btcbook.nownodes.io/wss/{nowNodesApiKey}'
  }),
  makeNowNode({
    pluginId: 'bitcoincash',
    url: 'wss://bchbook.nownodes.io/wss/{nowNodesApiKey}'
  }),
  makeNowNode({
    pluginId: 'dogecoin',
    url: 'wss://dogebook.nownodes.io/wss/{nowNodesApiKey}'
  }),
  makeNowNode({
    pluginId: 'litecoin',
    url: 'wss://ltcbook.nownodes.io/wss/{nowNodesApiKey}'
  }),
  makeNowNode({
    pluginId: 'qtum',
    url: 'wss://qtum-blockbook.nownodes.io/wss/{nowNodesApiKey}'
  }),

  makeEvmRpc({
    pluginId: 'binancesmartchain',
    urls: [
      'https://binance.llamarpc.com', // green privacy
      'https://bsc-rpc.publicnode.com', // green privacy
      'https://bsc.blockrazor.xyz', // green privacy
      'https://bsc.meowrpc.com', // green privacy
      'https://endpoints.omniatech.io/v1/bsc/mainnet/public', // green privacy
      'https://public-bsc-mainnet.fastnode.io', // green privacy
      'https://0.48.club', // yellow privacy
      'https://api-bsc-mainnet-full.n.dwellir.com/2ccf18bf-2916-4198-8856-42172854353c', // yellow privacy
      'https://api.zan.top/bsc-mainnet', // yellow privacy
      'https://binance-smart-chain-public.nodies.app', // yellow privacy
      'https://bnb.api.onfinality.io/public', // yellow privacy
      'https://go.getblock.io/cc778cdbdf5c4b028ec9456e0e6c0cf3', // yellow privacy
      'https://rpc-bsc.48.club', // yellow privacy
      'https://rpc.poolz.finance/bsc' // yellow privacy
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 56,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'botanix',
    urls: ['https://rpc.ankr.com/botanix_mainnet'], // green privacy
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: ['https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'ethereum',
    urls: [
      'https://0xrpc.io/eth', // green privacy
      'https://endpoints.omniatech.io/v1/eth/mainnet/public', // green privacy
      'https://eth.blockrazor.xyz', // green privacy
      'https://eth.llamarpc.com', // green privacy
      'https://eth.meowrpc.com', // green privacy
      'https://eth.merkle.io', // green privacy
      'https://ethereum-json-rpc.stakely.io', // green privacy
      'https://ethereum-rpc.publicnode.com', // green privacy
      'https://go.getblock.io/aefd01aa907c4805ba3c00a9e5b48c6b', // green privacy
      'https://rpc.flashbots.net', // green privacy
      'https://rpc.mevblocker.io', // green privacy
      'https://rpc.payload.de', // green privacy
      'https://api.zan.top/eth-mainnet', // yellow privacy
      'https://eth.api.onfinality.io/public', // yellow privacy
      'https://ethereum-public.nodies.app', // yellow privacy
      'https://rpc.poolz.finance/eth' // yellow privacy
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 1,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'optimism',
    urls: [
      'https://0xrpc.io/op', // green privacy
      'https://endpoints.omniatech.io/v1/op/mainnet/public', // green privacy
      'https://optimism-rpc.publicnode.com', // green privacy
      'https://public-op-mainnet.fastnode.io', // green privacy
      'https://api.zan.top/opt-mainnet', // yellow privacy
      'https://optimism-public.nodies.app', // yellow privacy
      'https://optimism.api.onfinality.io/public' // yellow privacy
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 10,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'polygon',
    urls: [
      'https://endpoints.omniatech.io/v1/matic/mainnet/public', // green privacy
      'https://polygon-bor-rpc.publicnode.com', // green privacy
      'https://polygon.meowrpc.com', // green privacy
      'https://api.zan.top/polygon-mainnet', // yellow privacy
      'https://polygon-public.nodies.app', // yellow privacy
      'https://polygon.api.onfinality.io/public', // yellow privacy
      'https://rpc.poolz.finance/polygon' // yellow privacy
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 137,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'zksync',
    urls: [
      'https://rpc.ankr.com/zksync_era', // green privacy
      'https://zksync.meowrpc.com', // green privacy
      'https://api.zan.top/zksync-mainnet', // yellow privacy
      'https://go.getblock.io/f76c09905def4618a34946bf71851542', // yellow privacy
      'https://zksync.api.onfinality.io/public' // yellow privacy
    ],
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: [
          'https://block-explorer-api.mainnet.zksync.io',
          'https://zksync.blockscout.com'
        ]
      },
      {
        type: 'etherscan-v2',
        chainId: 324,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),

  // Testing:
  makeFakePlugin()
]
