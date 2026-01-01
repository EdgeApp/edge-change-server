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

  // Ethereum family:
  // makeEvmRpc({
  //   pluginId: 'abstract',
  //   urls: [
  //     'https://abstract.api.onfinality.io/public' // yellow privacy
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 2741,
  //       urls: ['https://api.etherscan.io']
  //     }
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'amoy',
  //   urls: [
  //     'https://api.zan.top/polygon-amoy', // yellow privacy
  //     'https://polygon-amoy-public.nodies.app', // yellow privacy
  //     'https://polygon-amoy.api.onfinality.io/public' // yellow privacy
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'arbitrum',
  //   urls: [
  //     'https://arbitrum-one-rpc.publicnode.com', // green privacy
  //     'https://arbitrum.meowrpc.com', // green privacy
  //     'https://public-arb-mainnet.fastnode.io', // green privacy
  //     'https://api.zan.top/arb-one', // yellow privacy
  //     'https://arbitrum-one-public.nodies.app', // yellow privacy
  //     'https://arbitrum.api.onfinality.io/public', // yellow privacy
  //     'https://rpc.poolz.finance/arbitrum' // yellow privacy
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 42161,
  //       urls: ['https://api.etherscan.io']
  //     },
  //     {
  //       type: 'etherscan-v1',
  //       urls: ['https://api.routescan.io/v2/network/mainnet/evm/42161/etherscan']
  //     },
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'avalanche',
  //   urls: [
  //     'https://lb.drpc.org/ogrpc?network=avalanche&dkey={{drpcApiKey}}'
  //     // 'https://lb.drpc.live/avalanche/{{drpcApiKey}}'
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 43114,
  //       urls: ['https://api.etherscan.io']
  //     },
  //     {
  //       type: 'etherscan-v1',
  //       urls: [
  //         'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan'
  //       ]
  //     }
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'base',
  //   urls: [
  //     'https://lb.drpc.org/ogrpc?network=base&dkey={{drpcApiKey}}'
  //     // 'https://lb.drpc.live/base/{{drpcApiKey}}'
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 8453,
  //       urls: ['https://api.etherscan.io']
  //     },
  //     {
  //       type: 'etherscan-v1',
  //       urls: ['https://api.routescan.io/v2/network/mainnet/evm/8453/etherscan']
  //     }
  //   ]
  // }),
  makeEvmRpc({
    pluginId: 'binancesmartchain',
    urls: [
      'https://lb.drpc.org/ogrpc?network=bsc&dkey={{drpcApiKey}}'
      // 'https://lb.drpc.live/bsc/{{drpcApiKey}}'
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 56,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  // makeEvmRpc({
  //   pluginId: 'bobevm',
  //   urls: ['https://rpc.gobob.xyz'], // original URL - all chainlist RPCs failed
  //   scanAdapters: [
  //     { type: 'etherscan-v1', urls: ['https://explorer.gobob.xyz'] }
  //   ]
  // }),
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
  // makeEvmRpc({
  //   pluginId: 'celo',
  //   urls: [
  //     'https://lb.drpc.org/ogrpc?network=celo&dkey={{drpcApiKey}}'
  //     // 'https://lb.drpc.live/celo/{{drpcApiKey}}'
  //   ],
  //   scanAdapters: [
  //     { type: 'etherscan-v1', urls: ['https://explorer.celo.org/mainnet'] },
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 42220,
  //       urls: ['https://api.etherscan.io']
  //     }
  //   ]
  // }),
  makeEvmRpc({
    pluginId: 'ethereum',
    urls: [
      'https://mainnet.infura.io/v3/{{infuraProjectId}}',
      'https://lb.drpc.org/ogrpc?network=ethereum&dkey={{drpcApiKey}}'
      // 'https://lb.drpc.live/ethereum/{{drpcApiKey}}'
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
  // // makeEvmRpc({
  // //   pluginId: 'ethereumclassic',
  // //   urls: [
  // //     'https://0xrpc.io/etc', // green privacy
  // //     'https://etc.rivet.link', // green privacy
  // //     'https://ethereum-classic-mainnet.gateway.tatum.io' // green privacy
  // //   ],
  // //   scanAdapters: [
  // //     { type: 'etherscan-v1', urls: ['https://etc.blockscout.com'] }
  // //   ]
  // // }),
  // // makeEvmRpc({
  // //   pluginId: 'ethereumpow',
  // //   urls: ['https://mainnet.ethereumpow.org'] // no chainlist RPCs found, keeping original
  // // }),
  // // makeEvmRpc({
  // //   pluginId: 'fantom',
  // //   urls: [
  // //     'https://endpoints.omniatech.io/v1/fantom/mainnet/public', // green privacy
  // //     'https://fantom-json-rpc.stakely.io', // green privacy
  // //     'https://api.zan.top/ftm-mainnet', // yellow privacy
  // //     'https://fantom-public.nodies.app', // yellow privacy
  // //     'https://fantom.api.onfinality.io/public' // yellow privacy
  // //   ],
  // //   scanAdapters: [{ type: 'etherscan-v1', urls: ['https://ftmscout.com/'] }]
  // // }),
  // // makeEvmRpc({
  // //   pluginId: 'filecoinfevm',
  // //   urls: [
  // //     'https://filecoin.chainup.net/rpc/v1', // yellow privacy
  // //     'https://rpc.ankr.com/filecoin' // yellow privacy
  // //   ]
  // // }),
  // // makeEvmRpc({
  // //   pluginId: 'filecoinfevmcalibration',
  // //   urls: ['https://rpc.ankr.com/filecoin_testnet'] // original URL - all chainlist RPCs failed
  // // }),
  // // makeEvmRpc({
  // //   pluginId: 'holesky',
  // //   urls: ['https://ethereum-holesky-rpc.publicnode.com'], // original URL - all chainlist RPCs failed
  // //   scanAdapters: [
  // //     {
  // //       type: 'etherscan-v2',
  // //       chainId: 17000,
  // //       urls: ['https://api.etherscan.io']
  // //     }
  // //   ]
  // // }),
  // makeEvmRpc({
  //   pluginId: 'hyperevm',
  //   urls: ['https://rpc.hyperliquid.xyz/evm'], // no chainlist RPCs found, keeping original
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v1',
  //       urls: ['https://api.routescan.io/v2/network/mainnet/evm/999/etherscan']
  //     }
  //   ]
  // }),
  makeEvmRpc({
    pluginId: 'optimism',
    urls: [
      'https://lb.drpc.org/ogrpc?network=optimism&dkey={{drpcApiKey}}'
      // 'https://lb.drpc.live/optimism/{{drpcApiKey}}'
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
      'https://lb.drpc.org/ogrpc?network=polygon&dkey={{drpcApiKey}}'
      // 'https://lb.drpc.live/polygon/{{drpcApiKey}}'
    ],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 137,
        urls: ['https://api.etherscan.io']
      }
    ]
  }),
  // makeEvmRpc({
  //   pluginId: 'pulsechain',
  //   urls: [
  //     'https://pulsechain-rpc.publicnode.com', // green privacy
  //     'https://rpc.pulsechainrpc.com', // green privacy
  //     'https://rpc.pulsechainstats.com' // yellow privacy
  //   ],
  //   scanAdapters: [
  //     { type: 'etherscan-v1', urls: ['https://api.scan.pulsechain.com'] }
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'rsk',
  //   urls: ['https://public-node.rsk.co'], // original URL - all chainlist RPCs failed
  //   scanAdapters: [
  //     { type: 'etherscan-v1', urls: ['https://rootstock.blockscout.com/'] }
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'sepolia',
  //   urls: [
  //     'https://0xrpc.io/sep', // green privacy
  //     'https://ethereum-sepolia-rpc.publicnode.com', // green privacy
  //     'https://api.zan.top/eth-sepolia', // yellow privacy
  //     'https://eth-sepolia.api.onfinality.io/public', // yellow privacy
  //     'https://ethereum-sepolia-public.nodies.app' // yellow privacy
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 11155111,
  //       urls: ['https://api.etherscan.io']
  //     }
  //   ]
  // }),
  // makeEvmRpc({
  //   pluginId: 'sonic',
  //   urls: [
  //     'https://lb.drpc.org/ogrpc?network=sonic&dkey={{drpcApiKey}}'
  //     // 'https://lb.drpc.live/sonic/{{drpcApiKey}}'
  //   ],
  //   scanAdapters: [
  //     {
  //       type: 'etherscan-v2',
  //       chainId: 146,
  //       urls: ['https://api.etherscan.io']
  //     }
  //   ]
  // }),
  makeEvmRpc({
    pluginId: 'zksync',
    urls: [
      'https://lb.drpc.org/ogrpc?network=zksync&dkey={{drpcApiKey}}'
      // 'https://lb.drpc.live/zksync/{{drpcApiKey}}'
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
