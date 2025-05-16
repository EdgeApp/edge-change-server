import { createPublicClient, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'
import { makeEvents } from 'yavent'

import { serverConfig } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { pickRandom } from '../util/pickRandom'

export interface EvmRpcOptions {
  pluginId: string

  /** A clean URL for logging */
  safeUrl?: string
  /** The actual wss connection URL */
  url: string

  /** The Etherscan-like API URL for `scanAddress` capabilities. */
  evmScanUrls?: string[]
}

const ERC20_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

export function makeEvmRpc(opts: EvmRpcOptions): AddressPlugin {
  const { pluginId, safeUrl = opts.url, url, evmScanUrls } = opts

  const [on, emit] = makeEvents<PluginEvents>()

  const logPrefix = `${pluginId} (${safeUrl}):`
  const logger = {
    log: (...args: unknown[]): void => {
      console.log(logPrefix, ...args)
    },
    error: (...args: unknown[]): void => {
      console.error(logPrefix, ...args)
    },
    warn: (...args: unknown[]): void => {
      console.warn(logPrefix, ...args)
    }
  }

  // Track subscribed addresses (normalized lowercase address -> original address)
  const subscribedAddresses = new Map<string, string>()

  const client = createPublicClient({
    chain: mainnet,
    transport: http(url)
  })

  client.watchBlocks({
    includeTransactions: true,
    emitMissed: true,
    onError: error => {
      logger.error('watchBlocks error', error)
    },
    onBlock: async block => {
      logger.log('onBlock', block.number)
      // Skip processing if no subscriptions
      if (subscribedAddresses.size === 0) return

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

      // Emit update events for all affected subscribed addresses
      for (const originalAddress of addressesToUpdate) {
        emit('update', {
          address: originalAddress,
          checkpoint: block.number.toString()
        })
      }
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
      // If no API key is provided, then we have no way to implement scanAddress
      // so assume address has changed:
      if (evmScanUrls == null || evmScanUrls.length === 0) {
        return true
      }
      // Always assume address has changed if checkpoint is not provided:
      if (checkpoint == null) {
        return true
      }

      // Make sure address is normalized (lowercase):
      const normalizedAddress = address.toLowerCase()

      const params = new URLSearchParams({
        module: 'account',
        action: 'txlist',
        address: normalizedAddress,
        startblock: checkpoint,
        endblock: '999999999',
        sort: 'asc'
      })
      // Use a random API URL:
      const evmScanUrl = pickRandom(evmScanUrls)
      const host = new URL(evmScanUrl).host
      const apiKeys = serverConfig.serviceKeys[host]
      if (apiKeys == null) {
        logger.warn('No API key found for', host)
      }
      // Use a random API key:
      const apiKey = apiKeys == null ? undefined : pickRandom(apiKeys)
      if (apiKey != null) {
        params.set('apikey', apiKey)
      }
      const response = await fetch(`${evmScanUrl}/api?${params.toString()}`)
      if (response.status !== 200) {
        logger.error('scanAddress error', response.status, response.statusText)
        return true
      }
      const data = await response.json()

      // console.log(data)

      if (data.status === '1' && data.result.length > 0) {
        return true
      }

      return false
    }
  }

  return plugin
}
