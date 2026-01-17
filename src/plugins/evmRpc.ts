import { createPublicClient, fallback, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'
import { makeEvents } from 'yavent'

import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { getAddressPrefix } from '../util/addressUtils'
import { Logger, makeLogger } from '../util/logger'
import { pickRandom } from '../util/pickRandom'
import { makeEtherscanV1ScanAdapter } from '../util/scanAdapters/EtherscanV1ScanAdapter'
import { makeEtherscanV2ScanAdapter } from '../util/scanAdapters/EtherscanV2ScanAdapter'
import {
  ScanAdapter,
  ScanAdapterConfig
} from '../util/scanAdapters/scanAdapterTypes'

export interface EvmRpcOptions {
  pluginId: string

  /** The actual RPC connection URLs (will use fallback transport to try all) */
  urls: string[]

  /** The scan adapters to use for this plugin. */
  scanAdapters: ScanAdapterConfig[]

  /** Enable value-carrying internal transfer detection via traces (default `true`) */
  includeInternal?: boolean
}

const ERC20_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

export function makeEvmRpc(opts: EvmRpcOptions): AddressPlugin {
  const { pluginId, urls, scanAdapters } = opts

  const [on, emit] = makeEvents<PluginEvents>()

  const logger = makeLogger('evmRpc', pluginId)

  // Track subscribed addresses (normalized lowercase address -> original address)
  const subscribedAddresses = new Map<string, string>()

  // Create fallback transport with all URLs
  const transport = fallback(urls.map(url => http(url)))

  const client = createPublicClient({
    chain: mainnet,
    transport
  })

  const unwatchBlocks = client.watchBlocks({
    includeTransactions: true,
    emitMissed: true,
    onError: err => {
      logger.error({ err }, 'watchBlocks error')
    },
    onBlock: async block => {
      logger.info({
        blockNum: block.number.toString(),
        msg: 'block',
        numSubs: subscribedAddresses.size
      })

      // Skip processing if no subscriptions
      if (subscribedAddresses.size === 0) {
        return
      }

      // Track which subscribed addresses have updates in this block
      const addressesToUpdate = new Set<string>()

      // Check regular transactions
      block.transactions.forEach(tx => {
        const normalizedFromAddress = tx.from.toLowerCase()
        const normalizedToAddress = tx.to?.toLowerCase()
        const matchingFromAddress = subscribedAddresses.get(
          normalizedFromAddress
        )
        const matchingToAddress =
          normalizedToAddress !== undefined
            ? subscribedAddresses.get(normalizedToAddress)
            : undefined
        if (matchingFromAddress != null) {
          addressesToUpdate.add(matchingFromAddress)
        }
        if (matchingToAddress != null) {
          addressesToUpdate.add(matchingToAddress)
        }
      })

      // Check ERC20 transfers
      const transferLogs = await client
        .getLogs({
          blockHash: block.hash,
          event: ERC20_TRANSFER_EVENT
        })
        .catch(error => {
          logger.error({
            err: error,
            blockNum: block.number.toString(),
            msg: 'getLogs error'
          })
          throw error
        })
      transferLogs.forEach(log => {
        const normalizedFromAddress = log.args.from?.toLowerCase()
        const normalizedToAddress = log.args.to?.toLowerCase()
        const matchingFromAddress =
          normalizedFromAddress !== undefined
            ? subscribedAddresses.get(normalizedFromAddress)
            : undefined
        const matchingToAddress =
          normalizedToAddress !== undefined
            ? subscribedAddresses.get(normalizedToAddress)
            : undefined
        if (matchingFromAddress != null) {
          addressesToUpdate.add(matchingFromAddress)
        }
        if (matchingToAddress != null) {
          addressesToUpdate.add(matchingToAddress)
        }
      })

      let traceBlock = true
      // Internal native-value transfers via traces
      if (opts.includeInternal !== false) {
        const addressesFromTraces = new Set<string>()

        // Prefer parity/erigon trace_block (single RPC per block)
        let traced = false
        try {
          const blockTag = `0x${block.number.toString(16)}`
          const traces: any[] = await (client as any).request({
            method: 'trace_block',
            params: [blockTag]
          })
          traced = true
          for (const t of traces) {
            const action = t?.action ?? {}
            const from = (action.from ?? action.address ?? '').toLowerCase()
            const to = (action.to ?? action.address ?? '').toLowerCase()
            const matchFrom = subscribedAddresses.get(from)
            const matchTo = subscribedAddresses.get(to)
            if (matchFrom != null) addressesFromTraces.add(matchFrom)
            if (matchTo != null) addressesFromTraces.add(matchTo)
          }
        } catch (e) {
          // fall through to geth debug_traceTransaction
          traceBlock = false
        }

        if (!traced) {
          // Fallback: geth debug_traceTransaction with callTracer (heavier)
          const txHashes = block.transactions.map(tx => tx.hash)
          const results = await Promise.allSettled(
            txHashes.map(async hash =>
              (client as any).request({
                method: 'debug_traceTransaction',
                params: [
                  hash,
                  {
                    tracer: 'callTracer',
                    tracerConfig: { onlyTopCall: false }
                  }
                ]
              })
            )
          ).catch(error => {
            logger.error({ err: error }, 'debug_traceTransaction error')
            throw error
          })

          const walk = (node: any): void => {
            if (node == null) return
            const from = (node.from ?? '').toLowerCase()
            const to = (node.to ?? '').toLowerCase()
            const matchFrom = subscribedAddresses.get(from)
            const matchTo = subscribedAddresses.get(to)
            if (matchFrom != null) addressesFromTraces.add(matchFrom)
            if (matchTo != null) addressesFromTraces.add(matchTo)
            for (const c of node.calls ?? []) walk(c)
          }

          for (const r of results as any[]) {
            if (r.status !== 'fulfilled') continue
            walk((r as PromiseFulfilledResult<any>).value)
          }
        }

        for (const a of addressesFromTraces) {
          addressesToUpdate.add(a)
        }
      }

      // Emit update events for all affected subscribed addresses
      for (const originalAddress of addressesToUpdate) {
        logger.info({
          addr: getAddressPrefix(originalAddress),
          msg: 'tx detected'
        })
        emit('update', {
          address: originalAddress,
          checkpoint: block.number.toString()
        })
      }
      logger.info({
        blockNum: block.number.toString(),
        msg: 'block processed',
        internal: opts.includeInternal !== false,
        traceBlock,
        numSubs: subscribedAddresses.size,
        numUpdates: addressesToUpdate.size
      })
    }
  })

  const plugin: AddressPlugin = {
    pluginId,
    subscribe: async address => {
      const normalizedAddress = address.toLowerCase()
      subscribedAddresses.set(normalizedAddress, address)
      return true
    },
    unsubscribe: async address => {
      const normalizedAddress = address.toLowerCase()
      return subscribedAddresses.delete(normalizedAddress)
    },
    on,
    scanAddress: async (address, checkpoint): Promise<boolean> => {
      const scanAdapter = pickRandom(scanAdapters)
      if (scanAdapter == null) {
        // If no adapters are provided, then we have no way to implement
        // scanAddress.
        logger.error({ msg: 'No scan adapters provided', pluginId })
        return true
      }
      const adapter = getScanAdapter(scanAdapter, logger)
      return await adapter(address, checkpoint)
    },
    destroy() {
      unwatchBlocks()
      subscribedAddresses.clear()
    }
  }

  return plugin
}

function getScanAdapter(
  scanAdapterConfig: ScanAdapterConfig,
  logger: Logger
): ScanAdapter {
  switch (scanAdapterConfig.type) {
    case 'etherscan-v1':
      return makeEtherscanV1ScanAdapter(scanAdapterConfig, logger)
    case 'etherscan-v2':
      return makeEtherscanV2ScanAdapter(scanAdapterConfig, logger)
  }
}
