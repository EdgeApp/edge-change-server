import { AddressPlugin } from '../types/addressPlugin'
import { SigningKeyStore } from '../util/signingKeyStore'
import { WebhookRegistry } from '../util/webhookRegistry'
import { makeAlchemy } from './alchemy'
import { makeFakePlugin } from './fakePlugin'

export interface AllPluginsOptions {
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
}

export function makeAllPlugins(opts: AllPluginsOptions): AddressPlugin[] {
  const { signingKeyStore, webhookRegistry } = opts
  return [
    // Bitcoin family:
    // makeBlockbook({
    //   pluginId: 'bitcoin',
    //   url: 'wss://btcbook.nownodes.io/wss/{{apiKey}}'
    // }),
    // makeBlockbook({
    //   pluginId: 'bitcoincash',
    //   url: 'wss://bchbook.nownodes.io/wss/{{apiKey}}'
    // }),
    // makeBlockbook({
    //   pluginId: 'dogecoin',
    //   url: 'wss://dogebook.nownodes.io/wss/{{apiKey}}'
    // }),
    // makeBlockbook({
    //   pluginId: 'litecoin',
    //   url: 'wss://ltcbook.nownodes.io/wss/{{apiKey}}'
    // }),
    // makeBlockbook({
    //   pluginId: 'qtum',
    //   url: 'wss://qtum-blockbook.nownodes.io/wss/{{apiKey}}'
    // }),

    // EVM chains using Alchemy Address Activity webhooks:
    makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      signingKeyStore,
      webhookRegistry
    }),
    makeAlchemy({
      pluginId: 'polygon',
      network: 'MATIC_MAINNET',
      signingKeyStore,
      webhookRegistry
    }),
    makeAlchemy({
      pluginId: 'optimism',
      network: 'OPT_MAINNET',
      signingKeyStore,
      webhookRegistry
    }),

    // makeEvmRpc({
    //   pluginId: 'botanix',
    //   urls: [
    //     'wss://rpc.ankr.com/botanix_mainnet',
    //     'https://rpc.ankr.com/botanix_mainnet'
    //   ],
    //   scanAdapters: [
    //     {
    //       type: 'etherscan-v1',
    //       urls: [
    //         'https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan'
    //       ]
    //     }
    //   ]
    // }),
    // makeEvmRpc({
    //   pluginId: 'zksync',
    //   urls: [
    //     authenticateUrl(
    //       'wss://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
    //     ),
    //     authenticateUrl(
    //       'https://lb.drpc.org/ogrpc?network=zksync&dkey={{apiKey}}'
    //     )
    //   ],
    //   scanAdapters: [
    //     {
    //       type: 'etherscan-v2',
    //       chainId: 324,
    //       urls: ['https://api.etherscan.io']
    //     },
    //     {
    //       type: 'etherscan-v1',
    //       urls: [
    //         'https://api.routescan.io/v2/network/mainnet/evm/324/etherscan'
    //       ]
    //     }
    //   ]
    // }),

    // Testing:
    makeFakePlugin()
  ]
}
