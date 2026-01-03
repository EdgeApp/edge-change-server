import { createPublicClient, fallback, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'
import { makeEvents } from 'yavent'

import { replaceUrlParams } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { getAddressPrefix } from '../util/addressUtils'
import { Logger, makeLogger } from '../util/logger'
import { makeEtherscanV1ScanAdapter } from '../util/scanAdapters/EtherscanV1ScanAdapter'
import { makeEtherscanV2ScanAdapter } from '../util/scanAdapters/EtherscanV2ScanAdapter'
import {
  ScanAdapter,
  ScanAdapterConfig
} from '../util/scanAdapters/scanAdapterTypes'
import { snooze } from '../util/snooze'
import { shuffleArray } from '../util/utils'

const GET_LOGS_RETRY_DELAY = 250
const GET_LOGS_MAX_RETRIES = 10

export interface EvmRpcOptions {
  pluginId: string

  /** The actual RPC connection URLs (will use fallback transport to try all) */
  urls: string[]

  /** The scan adapters to use for this plugin. */
  scanAdapters?: ScanAdapterConfig[]

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

  // Create fallback transport with all URLs (replacing {{param}} placeholders)
  const transport = fallback(urls.map(url => http(replaceUrlParams(url))))

  const client = createPublicClient({
    chain: mainnet,
    transport
  })

  const unwatchBlocks = client.watchBlocks({
    includeTransactions: true,
    emitMissed: true,
    onError: error => {
      logger.error({
        t: `watchBlocks error: ${String(error)}`
      })
    },
    onBlock: async block => {
      logger({
        blockNum: block.number.toString(),
        t: 'block',
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
      let retries = 0
      while (true) {
        try {
          const transferLogs = await client.getLogs({
            blockHash: block.hash,
            event: ERC20_TRANSFER_EVENT
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
          break
        } catch (error) {
          if (retries++ < GET_LOGS_MAX_RETRIES) {
            const retryDelay = GET_LOGS_RETRY_DELAY * retries
            logger.error({
              blockNum: block.number.toString(),
              t: `getLogs error. Retrying in ${retryDelay}ms`
            })
            await snooze(retryDelay)
            continue
          }
          logger.error({
            blockNum: block.number.toString(),
            t: `getLogs error: ${String(error)}`
          })

          throw error
        }
      }

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
            logger.error({
              t: `debug_traceTransaction error: ${String(error)}`
            })
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
        logger({
          addr: getAddressPrefix(originalAddress),
          t: 'tx detected'
        })
        emit('update', {
          address: originalAddress,
          checkpoint: block.number.toString()
        })
      }
      logger({
        blockNum: block.number.toString(),
        t: 'block processed',
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
      // if no adapters are provided, then we have no way to implement
      // scanAddress.
      if (scanAdapters == null || scanAdapters.length === 0) {
        return true
      }
      const randomAdapters = shuffleArray(scanAdapters)
      for (let i = 0; i < randomAdapters.length; i++) {
        const randomAdapter = randomAdapters[i]
        const adapter = getScanAdapter(randomAdapter, logger)
        try {
          return await adapter(address, checkpoint)
        } catch (error) {
          const t =
            `scanAdapter error` +
            (i < randomAdapters.length - 1
              ? `, retrying...`
              : `, no more adapters to try`)
          logger.warn({
            t,
            error: String(error),
            address: getAddressPrefix(address),
            type: randomAdapter.type
          })
          continue
        }
      }
      return true
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
