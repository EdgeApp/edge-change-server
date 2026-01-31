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
      'https://lb.drpc.org/ogrpc?network=bsc&dkey={{apiKey}}'
      // 'https://lb.drpc.live/bsc/{{apiKey}}'
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
      'https://mainnet.infura.io/v3/{{apiKey}}',
      'https://lb.drpc.org/ogrpc?network=ethereum&dkey={{apiKey}}'
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 1,
        urls: ['https://api.etherscan.io']
      },
      {
        type: 'etherscan-v1',
        urls: ['https://api.routescan.io/v2/network/mainnet/evm/1/etherscan']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'optimism',
    urls: [
      'https://lb.drpc.org/ogrpc?network=optimism&dkey={{apiKey}}'
      // 'https://lb.drpc.live/optimism/{{apiKey}}'
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 10,
        urls: ['https://api.etherscan.io']
      },
      {
        type: 'etherscan-v1',
        urls: ['https://api.routescan.io/v2/network/mainnet/evm/10/etherscan']
      }
    ]
  }),
  makeEvmRpc({
    pluginId: 'polygon',
    urls: [
      'https://lb.drpc.org/ogrpc?network=polygon&dkey={{apiKey}}'
      // 'https://lb.drpc.live/polygon/{{apiKey}}'
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
      'https://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
      // 'https://lb.drpc.live/zksync/{{apiKey}}'
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 324,
        urls: ['https://api.etherscan.io']
      },
      {
        type: 'etherscan-v1',
        urls: ['https://api.routescan.io/v2/network/mainnet/evm/324/etherscan']
      }
    ]
  }),

  // Testing:
  makeFakePlugin()
]
