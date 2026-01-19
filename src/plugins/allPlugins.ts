import { AddressPlugin } from '../types/addressPlugin'
import { AlchemyWebhookHandler } from '../util/alchemyWebhookHandler'
import { authenticateUrl } from '../util/authenticateUrl'
import { makeAlchemy } from './alchemy'
import { makeBlockbook } from './blockbook'
import { makeEvmRpc } from './evmRpc'
import { makeFakePlugin } from './fakePlugin'

export function makeAllPlugins(
  webhookHandler: AlchemyWebhookHandler
): AddressPlugin[] {
  return [
    // Bitcoin family:
    makeBlockbook({
      pluginId: 'bitcoin',
      url: 'wss://btcbook.nownodes.io/wss/{{apiKey}}'
    }),
    makeBlockbook({
      pluginId: 'bitcoincash',
      url: 'wss://bchbook.nownodes.io/wss/{{apiKey}}'
    }),
    makeBlockbook({
      pluginId: 'dogecoin',
      url: 'wss://dogebook.nownodes.io/wss/{{apiKey}}'
    }),
    makeBlockbook({
      pluginId: 'litecoin',
      url: 'wss://ltcbook.nownodes.io/wss/{{apiKey}}'
    }),
    makeBlockbook({
      pluginId: 'qtum',
      url: 'wss://qtum-blockbook.nownodes.io/wss/{{apiKey}}'
    }),

    // EVM chains using Alchemy Address Activity webhooks:
    makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      webhookHandler
    }),
    makeAlchemy({
      pluginId: 'polygon',
      network: 'MATIC_MAINNET',
      webhookHandler
    }),
    makeAlchemy({
      pluginId: 'optimism',
      network: 'OPT_MAINNET',
      webhookHandler
    }),

    makeEvmRpc({
      pluginId: 'botanix',
      urls: [
        'wss://rpc.ankr.com/botanix_mainnet',
        'https://rpc.ankr.com/botanix_mainnet'
      ],
      scanAdapters: [
        {
          type: 'etherscan-v1',
          urls: [
            'https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan'
          ]
        }
      ]
    }),
    makeEvmRpc({
      pluginId: 'zksync',
      urls: [
        authenticateUrl(
          'wss://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
        ),
        authenticateUrl(
          'https://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
        )
      ],
      scanAdapters: [
        {
          type: 'etherscan-v2',
          chainId: 324,
          urls: ['https://api.etherscan.io']
        },
        {
          type: 'etherscan-v1',
          urls: [
            'https://api.routescan.io/v2/network/mainnet/evm/324/etherscan'
          ]
        }
      ]
    }),

    // Testing:
    makeFakePlugin()
  ]
}
