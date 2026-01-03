# Multi-Process Plugin Architecture

## Overview

This document describes the architecture for running blockchain plugins in separate Node.js processes, enabling better resource isolation, fault tolerance, and subscription deduplication.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Main Server Process                                                        │
│  ├── WebSocket Server (accepts client connections)                          │
│  ├── AddressHub (manages socket → subscription mappings)                    │
│  ├── PluginManager (spawns/manages plugin processes)                        │
│  └── PluginBridge[] (yaob bridges to each plugin process)                   │
└───────────────┬─────────────────────────────────┬───────────────────────────┘
                │ cluster.fork() + IPC + yaob     │ cluster.fork() + IPC + yaob
                ▼                                 ▼
┌───────────────────────────────────┐  ┌───────────────────────────────────────┐
│  Blockbook Plugin Process         │  │  EVM RPC Plugin Process               │
│  ─────────────────────────────    │  │  ─────────────────────────────────    │
│  Supported pluginIds:             │  │  Spawns a child process per chain:    │
│  • bitcoin                        │  │                                       │
│  • bitcoincash                    │  │  ┌─────────────┐  ┌─────────────┐     │
│  • litecoin                       │  │  │ ethereum    │  │ polygon     │     │
│  • dogecoin                       │  │  │ process     │  │ process     │     │
│  • qtum                           │  │  └─────────────┘  └─────────────┘     │
│  ─────────────────────────────    │  │  ┌─────────────┐  ┌─────────────┐     │
│  Single process handles all       │  │  │ avalanche   │  │ optimism    │     │
│  Blockbook chains.                │  │  │ process     │  │ process     │     │
│                                   │  │  └─────────────┘  └─────────────┘     │
└───────────────────────────────────┘  └───────────────────────────────────────┘
```

## Design Principles

1. **Hub-agnostic plugin internals** - The hub communicates with each plugin via a single yaob channel. How the plugin implements its internals (single process, multiple sub-processes, etc.) is entirely up to the plugin.
1. **Plugins define their own chain support** - Each plugin exports the list of chain pluginIds it supports.
1. **Optional sub-process spawning** - Plugins can optionally spawn child processes for individual chains. This is a plugin-level decision, not enforced by the architecture.
1. **Batch subscribe method** - Accepts arrays of `{pluginId, addresses[]}` for efficient subscription.
1. **Incremental subscriptions** - Clients can add/remove subscriptions on the same connection at any time.
1. **Idempotent operations** - Subscribe/unsubscribe calls are idempotent (safe to repeat).
1. **Process isolation via Node.js fork()** - Each plugin runs independently on its own process/thread.
1. **yaob for IPC** - Transparent object bridging between server and plugin processes.
1. **Event-based updates** - Plugins notify server via yaob callbacks when changes are detected.
1. **Disconnect notification** - Server informs plugins when clients disconnect.
1. **Unique connection identifiers** - Same pluginId/address combo may have multiple socket subscribers.
1. **Subscription deduplication** - Plugins deduplicate RPC connections and use reference counting for cleanup.

## Plugin Architecture Patterns

### Pattern 1: Single Process (e.g., Blockbook)

The plugin handles all chains in a single process. Good for plugins where chains share connection pooling or other resources.

```
Hub <──yaob──> Blockbook Plugin Process
                    │
                    ├── bitcoin subscriptions
                    ├── bitcoincash subscriptions
                    └── litecoin subscriptions
```

### Pattern 2: Sub-Process Per Chain (e.g., EVM RPC)

The plugin spawns a child process for each chain using `child_process.fork()`. Good for CPU-intensive work or chains that need isolation.

```
Hub <──yaob──> EVM RPC Plugin Process
                    │
                    ├──fork()──> ethereum chain worker
                    ├──fork()──> polygon chain worker
                    ├──fork()──> avalanche chain worker
                    └──fork()──> optimism chain worker
```

The hub doesn't know or care which pattern the plugin uses. It just calls the PluginApi methods.

## Type Definitions

### SubscribeRequest

The format for subscription requests from the server to plugins:

```typescript
interface AddressSubscription {
  address: string
  /** Block height or similar. May be missing on first subscription. */
  checkpoint?: string
}

interface SubscribeRequest {
  /** Unique identifier for the websocket connection */
  connectionId: string

  /** Subscriptions grouped by pluginId */
  subscriptions: Array<{
    pluginId: string
    addresses: AddressSubscription[]
  }>
}
```

### UnsubscribeRequest

```typescript
interface UnsubscribeRequest {
  /** Unique identifier for the websocket connection */
  connectionId: string

  /** Subscriptions to remove, grouped by pluginId */
  subscriptions: Array<{
    pluginId: string
    addresses: string[]  // Just addresses, no checkpoints needed
  }>
}
```

### PluginApi

The API that each plugin process exposes to the server via yaob:

```typescript
interface PluginApi {
  /** List of pluginIds this plugin handles */
  readonly pluginIds: string[]

  /**
   * Subscribe a connection to addresses.
   * Can be called multiple times to add more subscriptions.
   * Duplicate subscriptions are ignored (idempotent).
   */
  subscribe(request: SubscribeRequest): Promise<SubscribeResult[]>

  /**
   * Unsubscribe a connection from specific addresses.
   * Can be called multiple times to remove subscriptions incrementally.
   * Missing subscriptions are ignored (idempotent).
   */
  unsubscribe(request: UnsubscribeRequest): Promise<void>

  /**
   * Called when a connection disconnects.
   * Cleans up ALL subscriptions for this connection.
   */
  connectionClosed(connectionId: string): Promise<void>

  /** Graceful shutdown */
  stop(): Promise<void>
}
```

### SubscribeResult

Result codes for each subscription attempt:

```typescript
type SubscribeResult =
  | -1  // Not supported by this plugin
  |  0  // Failed (error occurred)
  |  1  // Subscribed, no changes detected
  |  2  // Subscribed, changes detected (needs resync)
```

### PluginCallbacks

Callbacks the server provides to plugins for notifications:

```typescript
interface PluginCallbacks {
  /** Called when an address has new activity */
  onUpdate(pluginId: string, address: string, checkpoint?: string): void

  /** Called when a subscription is lost (e.g., RPC disconnect) */
  onSubLost(pluginId: string, addresses: string[]): void
}
```

### PluginFactory

Each plugin exports a factory object:

```typescript
interface PluginFactory {
  /** Unique name for this plugin (e.g., 'blockbook', 'evmRpc') */
  readonly name: string

  /** List of chain pluginIds this plugin supports */
  readonly chainPluginIds: string[]

  /** Create the plugin instance */
  makePlugin(callbacks: PluginCallbacks): Promise<PluginApi>
}
```

## Implementation

### Main Entry Point (index.ts)

```typescript
// src/v2/index.ts

import cluster from 'cluster'
import WebSocket from 'ws'

import { runPluginWorker } from './plugin/pluginWorker'
import { makePluginManager } from './pluginManager'
import { makeAddressHub, makePluginCallbacks } from './hub'
import { blockbookPluginFactory } from './plugins/blockbook'
import { evmRpcPluginFactory } from './plugins/evmRpc'

// Plugins to start (each defines its own name and chainPluginIds)
const plugins = [blockbookPluginFactory, evmRpcPluginFactory]

async function main(): Promise<void> {
  if (cluster.isPrimary) {
    await runPrimary()
  } else if (process.env.PLUGIN_NAME != null) {
    await runPluginWorker()
  }
}

async function runPrimary(): Promise<void> {
  const connections = new Map<string, any>()
  const pluginCallbacks = makePluginCallbacks(connections)

  const pluginManager = makePluginManager(plugins, pluginCallbacks)
  await pluginManager.start()

  const hub = makeAddressHub({ pluginManager })

  const wss = new WebSocket.Server({ port: listenPort })
  wss.on('connection', (ws, req) => {
    hub.handleConnection(ws, ip)
  })
}
```

### EVM RPC Plugin with Sub-Processes

The evmRpc plugin spawns a separate process for each chain:

```typescript
// src/v2/plugins/evmRpc.ts

export const evmRpcPluginFactory: PluginFactory = {
  name: 'evmRpc',
  chainPluginIds: ['ethereum', 'polygon', 'avalanche', 'optimism', ...],

  makePlugin: async (callbacks: PluginCallbacks): Promise<PluginApi> => {
    const chainWorkers = new Map<string, ChainWorkerHandle>()

    // Spawn a worker process for each chain
    for (const config of chainConfigs) {
      const worker = await spawnChainWorker(
        config,
        (address, checkpoint) => callbacks.onUpdate(config.pluginId, address, checkpoint),
        (addresses) => callbacks.onSubLost(config.pluginId, addresses)
      )
      chainWorkers.set(config.pluginId, worker)
    }

    return {
      pluginIds: chainConfigs.map(c => c.pluginId),

      subscribe: async (request) => {
        // Route to appropriate chain worker
        for (const sub of request.subscriptions) {
          const worker = chainWorkers.get(sub.pluginId)
          if (worker != null) {
            return await worker.subscribe(request.connectionId, sub.addresses)
          }
        }
      },

      // ... unsubscribe, connectionClosed, stop
    }
  }
}
```

### Chain Worker (spawned by evmRpc plugin)

```typescript
// src/v2/plugins/evmRpcChainWorker.ts

// IPC message types between plugin and chain worker
export type ChainWorkerMessage =
  | { type: 'subscribe'; connectionId: string; addresses: [...] }
  | { type: 'unsubscribe'; connectionId: string; addresses: string[] }
  | { type: 'connectionClosed'; connectionId: string }
  | { type: 'stop' }

export type ChainWorkerResponse =
  | { type: 'subscribeResult'; results: [...] }
  | { type: 'update'; address: string; checkpoint?: string }
  | { type: 'subLost'; addresses: string[] }
  // ...

export function runChainWorker(): void {
  const config = JSON.parse(process.env.CHAIN_CONFIG!)
  // ... set up viem client, watch blocks, handle messages
}

export async function spawnChainWorker(
  config: ChainConfig,
  onUpdate: (address: string, checkpoint?: string) => void,
  onSubLost: (addresses: string[]) => void
): Promise<ChainWorkerHandle> {
  const child = fork(__filename, [], {
    env: { ...process.env, CHAIN_CONFIG: JSON.stringify(config), RUN_CHAIN_WORKER: 'true' }
  })
  // ... set up IPC message handling
}
```

## File Structure

```
src/v2/
├── index.ts                    # Entry point (cluster primary/worker routing)
├── hub.ts                      # Routes subscriptions to plugins
├── pluginManager.ts            # Spawns/manages plugin workers via cluster
├── types/
│   └── pluginTypes.ts          # Plugin architecture types
├── plugin/
│   ├── pluginWorker.ts         # Worker entry point (PLUGIN_NAME env var)
│   └── subscriptionState.ts    # Shared subscription tracking utilities
└── plugins/
    ├── blockbook.ts            # Blockbook plugin (single process)
    ├── evmRpc.ts               # EVM RPC plugin (spawns chain workers)
    └── evmRpcChainWorker.ts    # Chain worker (spawned by evmRpc)
```

## Benefits

| Aspect | Single Process | Multi-Process Plugins | Sub-Process Per Chain |
|--------|----------------|----------------------|----------------------|
| **Process Isolation** | None | Plugin-level | Chain-level |
| **Fault Tolerance** | None | Plugin crash isolated | Chain crash isolated |
| **CPU Utilization** | Single core | Multi-core | Maximum parallelism |
| **Memory Overhead** | Minimal | Per-plugin | Per-chain |
| **Complexity** | Low | Medium | Higher |

## When to Use Sub-Processes

Use the sub-process pattern when:
- Each chain does CPU-intensive work (tracing, log parsing)
- Chains have different RPC rate limits or reliability
- You want maximum fault isolation
- The plugin supports many chains

Use the single-process pattern when:
- Chains share connection pools or state
- The work is I/O bound, not CPU bound
- Simplicity is preferred
- The plugin supports few chains

## Error Handling

- Plugin process crash: PluginManager detects exit, restarts plugin
- Chain worker crash: Plugin can detect and restart the specific chain worker
- IPC errors: Logged, bridge attempts reconnection
- RPC failures: Plugin emits `onSubLost`, clients notified to re-subscribe
