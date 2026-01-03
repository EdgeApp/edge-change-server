// src/v2/plugins/evmrpc/evmrpc.ts
// EVM RPC Plugin - spawns a separate process for each chain

import { makeLogger } from '../../../util/logger'
import {
  PluginApi,
  PluginCallbacks,
  PluginFactory,
  SubscribeRequest,
  SubscribeResult,
  UnsubscribeRequest
} from '../../types/pluginTypes'
import {
  ChainConfig,
  ChainWorkerHandle,
  spawnChainWorker
} from './evmRpcWorker'

/** All supported EVM chains */
const chainConfigs: ChainConfig[] = [
  {
    pluginId: 'avalanche',
    urls: ['https://lb.drpc.org/ogrpc?network=avalanche&dkey={{drpcApiKey}}'],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 43114,
        urls: ['https://api.etherscan.io']
      },
      {
        type: 'etherscan-v1',
        urls: [
          'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan'
        ]
      }
    ]
  },
  {
    pluginId: 'binancesmartchain',
    urls: ['https://lb.drpc.org/ogrpc?network=bsc&dkey={{drpcApiKey}}'],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 56,
        urls: ['https://api.etherscan.io']
      }
    ]
  },
  {
    pluginId: 'botanix',
    urls: ['https://rpc.ankr.com/botanix_mainnet'],
    scanAdapters: [
      {
        type: 'etherscan-v1',
        urls: ['https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan']
      }
    ]
  },
  {
    pluginId: 'ethereum',
    urls: [
      'https://mainnet.infura.io/v3/{{infuraProjectId}}',
      'https://lb.drpc.org/ogrpc?network=ethereum&dkey={{drpcApiKey}}'
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
  },
  {
    pluginId: 'optimism',
    urls: ['https://lb.drpc.org/ogrpc?network=optimism&dkey={{drpcApiKey}}'],
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
  },
  {
    pluginId: 'polygon',
    urls: ['https://lb.drpc.org/ogrpc?network=polygon&dkey={{drpcApiKey}}'],
    scanAdapters: [
      {
        type: 'etherscan-v2',
        chainId: 137,
        urls: ['https://api.etherscan.io']
      }
    ]
  },
  {
    pluginId: 'zksync',
    urls: ['https://lb.drpc.org/ogrpc?network=zksync&dkey={{drpcApiKey}}'],
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
  }
]

export const evmrpcPluginFactory: PluginFactory = {
  name: 'evmrpc',
  chainPluginIds: chainConfigs.map(c => c.pluginId),

  makePlugin: async (callbacks: PluginCallbacks): Promise<PluginApi> => {
    const logger = makeLogger('evmrpc')

    // Map of pluginId -> chain worker handle
    const chainWorkers = new Map<string, ChainWorkerHandle>()

    // Spawn a worker process for each chain
    logger({ t: 'spawning chain workers', count: chainConfigs.length })

    await Promise.all(
      chainConfigs.map(async config => {
        const worker = await spawnChainWorker(
          config,
          // onUpdate: forward to plugin callbacks
          (address: string, checkpoint?: string) => {
            callbacks.onUpdate(config.pluginId, address, checkpoint)
          },
          // onSubLost: forward to plugin callbacks
          (addresses: string[]) => {
            callbacks.onSubLost(config.pluginId, addresses)
          }
        )
        chainWorkers.set(config.pluginId, worker)
      })
    )

    logger({ t: 'all chain workers ready', count: chainWorkers.size })

    const plugin: PluginApi = {
      pluginIds: chainConfigs.map(c => c.pluginId),

      subscribe: async (
        request: SubscribeRequest
      ): Promise<SubscribeResult[]> => {
        const results: SubscribeResult[] = []

        // Group by pluginId and route to appropriate worker
        await Promise.all(
          request.subscriptions.map(async sub => {
            const worker = chainWorkers.get(sub.pluginId)

            if (worker == null) {
              // Not supported by this plugin
              for (const addr of sub.addresses) {
                results.push({
                  pluginId: sub.pluginId,
                  address: addr.address,
                  result: -1
                })
              }
              return
            }

            try {
              const workerResults = await worker.subscribe(
                request.connectionId,
                sub.addresses
              )

              for (const r of workerResults) {
                results.push({
                  pluginId: sub.pluginId,
                  address: r.address,
                  result: r.result
                })
              }
            } catch (error) {
              logger.error({
                t: 'subscribe error',
                pluginId: sub.pluginId,
                error: String(error)
              })
              for (const addr of sub.addresses) {
                results.push({
                  pluginId: sub.pluginId,
                  address: addr.address,
                  result: 0
                })
              }
            }
          })
        )

        return results
      },

      unsubscribe: async (request: UnsubscribeRequest): Promise<void> => {
        await Promise.all(
          request.subscriptions.map(async sub => {
            const worker = chainWorkers.get(sub.pluginId)
            if (worker == null) return

            try {
              await worker.unsubscribe(request.connectionId, sub.addresses)
            } catch (error) {
              logger.error({
                t: 'unsubscribe error',
                pluginId: sub.pluginId,
                error: String(error)
              })
            }
          })
        )
      },

      connectionClosed: async (connectionId: string): Promise<void> => {
        await Promise.all(
          Array.from(chainWorkers.values()).map(async worker => {
            try {
              await worker.connectionClosed(connectionId)
            } catch (error) {
              logger.error({
                t: 'connectionClosed error',
                pluginId: worker.pluginId,
                error: String(error)
              })
            }
          })
        )
      },

      stop: async (): Promise<void> => {
        logger({ t: 'stopping evmrpc plugin' })

        await Promise.all(
          Array.from(chainWorkers.values()).map(async worker => {
            try {
              await worker.stop()
            } catch (error) {
              logger.error({
                t: 'stop error',
                pluginId: worker.pluginId,
                error: String(error)
              })
            }
          })
        )

        chainWorkers.clear()
        logger({ t: 'evmrpc plugin stopped' })
      },

      debugTriggerUpdate: async (
        pluginId: string,
        address: string
      ): Promise<void> => {
        logger({ t: 'DEBUG: triggering fake update', pluginId, address })
        const worker = chainWorkers.get(pluginId)
        if (worker != null) {
          await worker.debugTriggerUpdate(address)
        }
      }
    }

    return plugin
  }
}
