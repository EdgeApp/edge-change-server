// Worker process for a single EVM chain
// Spawned by the evmrpc plugin, one per chain

import { ChildProcess, fork } from 'child_process'
import { createPublicClient, fallback, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'

import { replaceUrlParams } from '../../../serverConfig'
import { getAddressPrefix } from '../../../util/addressUtils'
import { Logger, makeLogger } from '../../../util/logger'
import { makeEtherscanV1ScanAdapter } from '../../../util/scanAdapters/EtherscanV1ScanAdapter'
import { makeEtherscanV2ScanAdapter } from '../../../util/scanAdapters/EtherscanV2ScanAdapter'
import {
  ScanAdapter,
  ScanAdapterConfig
} from '../../../util/scanAdapters/scanAdapterTypes'
import { snooze } from '../../../util/snooze'
import { shuffleArray } from '../../../util/utils'
import {
  cleanupConnection,
  makeSubscriptionState,
  trackSubscription,
  untrackSubscription
} from '../../plugin/subscriptionState'

const GET_LOGS_RETRY_DELAY = 250
const GET_LOGS_MAX_RETRIES = 10

const ERC20_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

// ─────────────────────────────────────────────────────────────────────────────
// IPC Message Types (between plugin process and chain worker)
// ─────────────────────────────────────────────────────────────────────────────

/** Chain configuration sent when spawning worker */
export interface ChainConfig {
  pluginId: string
  urls: string[]
  scanAdapters?: ScanAdapterConfig[]
  includeInternal?: boolean
}

/** Messages from plugin to chain worker (without id, added by sendRequest) */
export type ChainWorkerMessage =
  | {
      type: 'subscribe'
      connectionId: string
      addresses: Array<{ address: string; checkpoint?: string }>
    }
  | {
      type: 'unsubscribe'
      connectionId: string
      addresses: string[]
    }
  | { type: 'connectionClosed'; connectionId: string }
  | { type: 'stop' }
  | { type: 'debugTriggerUpdate'; address: string }

/** Messages from plugin to chain worker (with id) */
export type ChainWorkerRequest = ChainWorkerMessage & { id: number }

/** Messages from chain worker to plugin */
export type ChainWorkerResponse =
  | {
      type: 'subscribeResult'
      id: number
      results: Array<{ address: string; result: -1 | 0 | 1 | 2 }>
    }
  | { type: 'unsubscribeResult'; id: number }
  | { type: 'connectionClosedResult'; id: number }
  | { type: 'stopResult'; id: number }
  | { type: 'debugTriggerUpdateResult'; id: number }
  | { type: 'update'; address: string; checkpoint?: string }
  | { type: 'subLost'; addresses: string[] }
  | { type: 'ready' }
  | { type: 'error'; id?: number; error: string }

// ─────────────────────────────────────────────────────────────────────────────
// Chain Worker Process Entry Point
// ─────────────────────────────────────────────────────────────────────────────

export function runChainWorker(): void {
  // Get config from environment (JSON-encoded)
  const configJson = process.env.CHAIN_CONFIG
  if (configJson == null) {
    throw new Error('CHAIN_CONFIG env var not set')
  }

  const config: ChainConfig = JSON.parse(configJson)
  const { pluginId } = config

  const logger = makeLogger('evmrpc', pluginId)
  const subscriptionState = makeSubscriptionState()

  // Maps normalized address -> original address
  const subscribedAddresses = new Map<string, string>()

  // Set up RPC client
  const transport = fallback(
    config.urls.map(url => http(replaceUrlParams(url)))
  )
  const client = createPublicClient({
    chain: mainnet,
    transport
  })

  // Helper to send messages to parent
  const sendToParent = (msg: ChainWorkerResponse): void => {
    if (process.send != null) {
      process.send(msg)
    }
  }

  // Start watching blocks
  const unwatchBlocks = client.watchBlocks({
    includeTransactions: true,
    emitMissed: true,
    onError: error => {
      logger.error({ t: `watchBlocks error: ${String(error)}` })
    },
    onBlock: async block => {
      logger({
        blockNum: block.number.toString(),
        t: 'block',
        numSubs: subscribedAddresses.size
      })

      if (subscribedAddresses.size === 0) return

      const addressesToUpdate = new Set<string>()

      // Check regular transactions
      block.transactions.forEach(tx => {
        const normalizedFrom = tx.from.toLowerCase()
        const normalizedTo = tx.to?.toLowerCase()
        const matchFrom = subscribedAddresses.get(normalizedFrom)
        const matchTo =
          normalizedTo != null
            ? subscribedAddresses.get(normalizedTo)
            : undefined
        if (matchFrom != null) addressesToUpdate.add(matchFrom)
        if (matchTo != null) addressesToUpdate.add(matchTo)
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
            const normalizedFrom = log.args.from?.toLowerCase()
            const normalizedTo = log.args.to?.toLowerCase()
            const matchFrom =
              normalizedFrom != null
                ? subscribedAddresses.get(normalizedFrom)
                : undefined
            const matchTo =
              normalizedTo != null
                ? subscribedAddresses.get(normalizedTo)
                : undefined
            if (matchFrom != null) addressesToUpdate.add(matchFrom)
            if (matchTo != null) addressesToUpdate.add(matchTo)
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

      // Internal transfers via traces
      let traceBlock = true
      if (config.includeInternal !== false) {
        const addressesFromTraces = new Set<string>()

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
        } catch {
          traceBlock = false
        }

        if (!traced) {
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

      // Emit updates via IPC
      for (const originalAddress of addressesToUpdate) {
        logger({
          addr: getAddressPrefix(originalAddress),
          t: 'tx detected'
        })
        sendToParent({
          type: 'update',
          address: originalAddress,
          checkpoint: block.number.toString()
        })
      }

      logger({
        blockNum: block.number.toString(),
        t: 'block processed',
        internal: config.includeInternal !== false,
        traceBlock,
        numSubs: subscribedAddresses.size,
        numUpdates: addressesToUpdate.size
      })
    }
  })

  // Handle messages from parent (plugin process)
  const handleMessage = async (msg: ChainWorkerRequest): Promise<void> => {
    try {
      switch (msg.type) {
        case 'subscribe': {
          const results: Array<{ address: string; result: -1 | 0 | 1 | 2 }> = []

          for (const addr of msg.addresses) {
            const isNew = trackSubscription(
              subscriptionState,
              msg.connectionId,
              addr.address
            )

            if (isNew) {
              const normalized = addr.address.toLowerCase()
              subscribedAddresses.set(normalized, addr.address)
            }

            // Scan if checkpoint provided
            let hasChanges = true
            if (addr.checkpoint != null && config.scanAdapters != null) {
              try {
                hasChanges = await scanAddress(
                  config,
                  logger,
                  addr.address,
                  addr.checkpoint
                )
              } catch {
                hasChanges = true
              }
            }

            results.push({
              address: addr.address,
              result: hasChanges ? 2 : 1
            })
          }

          sendToParent({ type: 'subscribeResult', id: msg.id, results })
          break
        }

        case 'unsubscribe': {
          for (const address of msg.addresses) {
            const shouldUnsubscribe = untrackSubscription(
              subscriptionState,
              msg.connectionId,
              address
            )
            if (shouldUnsubscribe) {
              subscribedAddresses.delete(address.toLowerCase())
            }
          }
          sendToParent({ type: 'unsubscribeResult', id: msg.id })
          break
        }

        case 'connectionClosed': {
          const addressesToRemove = cleanupConnection(
            subscriptionState,
            msg.connectionId
          )
          for (const address of addressesToRemove) {
            subscribedAddresses.delete(address.toLowerCase())
          }
          sendToParent({ type: 'connectionClosedResult', id: msg.id })
          break
        }

        case 'stop': {
          unwatchBlocks()
          subscribedAddresses.clear()
          sendToParent({ type: 'stopResult', id: msg.id })
          process.exit(0)
        }

        case 'debugTriggerUpdate': {
          // Debug: manually trigger an update for testing
          logger({ t: 'DEBUG: triggering fake update', address: msg.address })
          sendToParent({
            type: 'update',
            address: msg.address,
            checkpoint: '12345678'
          })
          sendToParent({ type: 'debugTriggerUpdateResult', id: msg.id })
          break
        }
      }
    } catch (error) {
      sendToParent({
        type: 'error',
        id: msg.id,
        error: String(error)
      })
    }
  }

  process.on('message', (msg: ChainWorkerRequest) => {
    handleMessage(msg).catch(error => {
      sendToParent({
        type: 'error',
        id: msg.id,
        error: String(error)
      })
    })
  })

  // Exit if parent process dies (IPC channel disconnects)
  process.on('disconnect', () => {
    logger({ t: 'parent disconnected, shutting down' })
    unwatchBlocks()
    process.exit(0)
  })

  // Ignore SIGINT/SIGTERM - we only exit via IPC 'stop' message or parent disconnect.
  // This prevents race conditions when the terminal sends SIGINT to the entire
  // process group - we want the parent (plugin worker) to orchestrate shutdown.
  process.on('SIGTERM', () => {
    logger({ t: 'ignoring SIGTERM, waiting for parent to stop us' })
  })
  process.on('SIGINT', () => {
    logger({ t: 'ignoring SIGINT, waiting for parent to stop us' })
  })

  // Signal ready
  logger({ t: 'chain worker ready' })
  sendToParent({ type: 'ready' })
}

async function scanAddress(
  config: ChainConfig,
  logger: Logger,
  address: string,
  checkpoint: string
): Promise<boolean> {
  if (config.scanAdapters == null || config.scanAdapters.length === 0) {
    return true
  }

  const randomAdapters = shuffleArray(config.scanAdapters)
  for (let i = 0; i < randomAdapters.length; i++) {
    const adapterConfig = randomAdapters[i]
    const adapter = getScanAdapter(adapterConfig, logger)
    try {
      const hasChanges = await adapter(address, checkpoint)
      logger({
        t: hasChanges ? 'scanAddress found changes' : 'scanAddress no changes',
        address: getAddressPrefix(address),
        checkpoint,
        type: adapterConfig.type
      })
      return hasChanges
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
        type: adapterConfig.type
      })
      continue
    }
  }
  return true
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

// ─────────────────────────────────────────────────────────────────────────────
// Chain Worker Manager (used by plugin to spawn/manage chain workers)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChainWorkerHandle {
  pluginId: string
  process: ChildProcess
  subscribe: (
    connectionId: string,
    addresses: Array<{ address: string; checkpoint?: string }>
  ) => Promise<Array<{ address: string; result: -1 | 0 | 1 | 2 }>>
  unsubscribe: (connectionId: string, addresses: string[]) => Promise<void>
  connectionClosed: (connectionId: string) => Promise<void>
  stop: () => Promise<void>
  /** Debug: trigger a fake update for testing */
  debugTriggerUpdate: (address: string) => Promise<void>
}

export async function spawnChainWorker(
  config: ChainConfig,
  onUpdate: (address: string, checkpoint?: string) => void,
  onSubLost: (addresses: string[]) => void
): Promise<ChainWorkerHandle> {
  return await new Promise((resolve, reject) => {
    const logger = makeLogger('evmrpc', config.pluginId)

    // Fork this file as a child process with chain config
    const child = fork(__filename, [], {
      env: {
        ...process.env,
        CHAIN_CONFIG: JSON.stringify(config),
        RUN_CHAIN_WORKER: 'true'
      }
    })

    let nextRequestId = 1
    const pendingRequests = new Map<
      number,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >()

    async function sendRequest<T>(msg: ChainWorkerMessage): Promise<T> {
      return await new Promise<T>((resolve, reject) => {
        const id = nextRequestId++
        pendingRequests.set(id, { resolve, reject })
        child.send({ ...msg, id })
      })
    }

    child.on('message', (msg: ChainWorkerResponse) => {
      switch (msg.type) {
        case 'ready': {
          logger({ t: 'chain worker spawned' })
          resolve({
            pluginId: config.pluginId,
            process: child,

            subscribe: async (connectionId, addresses) => {
              return await sendRequest<
                Array<{ address: string; result: -1 | 0 | 1 | 2 }>
              >({
                type: 'subscribe',
                connectionId,
                addresses
              })
            },

            unsubscribe: async (connectionId, addresses) => {
              await sendRequest<undefined>({
                type: 'unsubscribe',
                connectionId,
                addresses
              })
            },

            connectionClosed: async connectionId => {
              await sendRequest<undefined>({
                type: 'connectionClosed',
                connectionId
              })
            },

            stop: async () => {
              await sendRequest<undefined>({ type: 'stop' })
            },

            debugTriggerUpdate: async (address: string) => {
              await sendRequest<undefined>({
                type: 'debugTriggerUpdate',
                address
              })
            }
          })
          break
        }

        case 'subscribeResult': {
          const pending = pendingRequests.get(msg.id)
          if (pending != null) {
            pendingRequests.delete(msg.id)
            pending.resolve(msg.results)
          }
          break
        }

        case 'unsubscribeResult':
        case 'connectionClosedResult':
        case 'stopResult':
        case 'debugTriggerUpdateResult': {
          const pending = pendingRequests.get(msg.id)
          if (pending != null) {
            pendingRequests.delete(msg.id)
            pending.resolve(undefined)
          }
          break
        }

        case 'update': {
          onUpdate(msg.address, msg.checkpoint)
          break
        }

        case 'subLost': {
          onSubLost(msg.addresses)
          break
        }

        case 'error': {
          if (msg.id != null) {
            const pending = pendingRequests.get(msg.id)
            if (pending != null) {
              pendingRequests.delete(msg.id)
              pending.reject(new Error(msg.error))
            }
          }
          logger.error({ t: 'chain worker error', error: msg.error })
          break
        }
      }
    })

    child.on('error', error => {
      logger.error({ t: 'chain worker error', error: String(error) })
      reject(error)
    })

    child.on('exit', (code, signal) => {
      logger.warn({ t: 'chain worker exited', code, signal })
      // Reject any pending requests
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error(`Chain worker exited: ${String(code)}`))
      }
      pendingRequests.clear()
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point check - run as chain worker if RUN_CHAIN_WORKER is set
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.RUN_CHAIN_WORKER === 'true') {
  runChainWorker()
}
