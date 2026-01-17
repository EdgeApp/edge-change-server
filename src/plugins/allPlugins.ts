import { authenticateUrl } from '../util/authenticateUrl'
import { makeBlockbook } from './blockbook'
import { makeEvmRpc } from './evmRpc'
import { makeFakePlugin } from './fakePlugin'

export const allPlugins = [
  // Bitcoin family:
  makeBlockbook({
    pluginId: 'bitcoin',
    url: authenticateUrl('wss://btcbook.nownodes.io/wss/{{apiKey}}')
  }),
  makeBlockbook({
    pluginId: 'bitcoincash',
    url: authenticateUrl('wss://bchbook.nownodes.io/wss/{{apiKey}}')
  }),
  makeBlockbook({
    pluginId: 'dogecoin',
    url: authenticateUrl('wss://dogebook.nownodes.io/wss/{{apiKey}}')
  }),
  makeBlockbook({
    pluginId: 'litecoin',
    url: authenticateUrl('wss://ltcbook.nownodes.io/wss/{{apiKey}}')
  }),
  makeBlockbook({
    pluginId: 'qtum',
    url: authenticateUrl('wss://qtum-blockbook.nownodes.io/wss/{{apiKey}}')
  }),

  makeEvmRpc({
    pluginId: 'binancesmartchain',
    urls: [
      authenticateUrl('https://lb.drpc.org/ogrpc?network=bsc&dkey={{apiKey}}')
      // authenticateUrl('https://lb.drpc.live/bsc/{{apiKey}}')
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
      authenticateUrl('https://mainnet.infura.io/v3/{{apiKey}}'),
      authenticateUrl(
        'https://lb.drpc.org/ogrpc?network=ethereum&dkey={{apiKey}}'
      )
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
      authenticateUrl(
        'https://lb.drpc.org/ogrpc?network=optimism&dkey={{apiKey}}'
      )
      // authenticateUrl('https://lb.drpc.live/optimism/{{apiKey}}')
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
      authenticateUrl(
        'https://lb.drpc.org/ogrpc?network=polygon&dkey={{apiKey}}'
      )
      // authenticateUrl('https://lb.drpc.live/polygon/{{apiKey}}')
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
      authenticateUrl(
        'https://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
      )
      // authenticateUrl('https://lb.drpc.live/zksync/{{apiKey}}')
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
