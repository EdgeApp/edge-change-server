import { AddressPlugin } from '../types/addressPlugin'
import { AlchemyNotifyApi } from '../util/alchemyNotifyApi'
import { SigningKeyStore } from '../util/signingKeyStore'
import { WebhookRegistry } from '../util/webhookRegistry'
import { makeAlchemy } from './alchemy'
import { makeEvmRpc } from './evmRpc'
import { makeFakePlugin } from './fakePlugin'

interface AllPluginOptions {
  notifyApi: AlchemyNotifyApi
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
}

const evmNormalizeAddress = (addr: string): string => addr.toLowerCase()

export function makeAllPlugins(opts: AllPluginOptions): AddressPlugin[] {
  const { notifyApi, signingKeyStore, webhookRegistry } = opts

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

    // EVM chains using EvmRpc polling (not supported by Alchemy):
    makeEvmRpc({
      pluginId: 'botanix',
      urls: ['https://rpc.ankr.com/botanix_mainnet'],
      scanAdapters: [
        {
          type: 'etherscan-v1',
          urls: [
            'https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan'
          ]
        }
      ]
    }),

    // EVM chains using Alchemy Address Activity webhooks:
    makeAlchemy({
      pluginId: 'abstract',
      network: 'ABSTRACT_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'arbitrum',
      network: 'ARB_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'avalanche',
      network: 'AVAX_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'base',
      network: 'BASE_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'binancesmartchain',
      network: 'BNB_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'celo',
      network: 'CELO_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'ethereum',
      network: 'ETH_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'fantom',
      network: 'FANTOM_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'optimism',
      network: 'OPT_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'polygon',
      network: 'MATIC_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'rsk',
      network: 'ROOTSTOCK_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'solana',
      network: 'SOLANA_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry
      // Solana uses base58 addresses (case-sensitive), no normalization needed
    }),
    makeAlchemy({
      pluginId: 'sonic',
      network: 'SONIC_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),
    makeAlchemy({
      pluginId: 'zksync',
      network: 'ZKSYNC_MAINNET',
      notifyApi,
      signingKeyStore,
      webhookRegistry,
      normalizeAddress: evmNormalizeAddress
    }),

    // Testing:
    makeFakePlugin()
  ]
}
