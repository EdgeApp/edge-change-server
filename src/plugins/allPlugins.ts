import { serverConfig } from '../server-config'
import { AddressPlugin } from '../types/addressPlugin'
import { BlockbookOptions, makeBlockbook } from './blockbook'
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
  makeNowNode({
    pluginId: 'arbitrum',
    url: 'wss://arb-blockbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'avalanche',
    url: 'wss://avax-blockbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'base',
    url: 'wss://base-blockbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'ethereum',
    url: 'wss://eth-blockbook.nownodes.io/wss'
  }),
  makeNowNode({
    pluginId: 'polygon',
    url: 'wss://maticbook.nownodes.io/wss'
  }),

  // Testing:
  makeFakePlugin()
]
