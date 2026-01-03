// src/v2/types/pluginTypes.ts

/** Address with optional checkpoint for subscription */
export interface AddressSubscription {
  address: string
  checkpoint?: string
}

/** Request to subscribe a connection to addresses */
export interface SubscribeRequest {
  connectionId: string
  subscriptions: Array<{
    pluginId: string
    addresses: AddressSubscription[]
  }>
}

/** Request to unsubscribe a connection from addresses */
export interface UnsubscribeRequest {
  connectionId: string
  subscriptions: Array<{
    pluginId: string
    addresses: string[]
  }>
}

/** Result of a subscription attempt */
export type SubscribeResultCode = -1 | 0 | 1 | 2

export interface SubscribeResult {
  pluginId: string
  address: string
  result: SubscribeResultCode
  /** Current checkpoint (block height, etc.) if available */
  checkpoint?: string
}

/** API exposed by plugin process to server */
export interface PluginApi {
  readonly pluginIds: string[]
  subscribe: (request: SubscribeRequest) => Promise<SubscribeResult[]>
  unsubscribe: (request: UnsubscribeRequest) => Promise<void>
  connectionClosed: (connectionId: string) => Promise<void>
  stop: () => Promise<void>
  /** Debug: trigger a fake update for testing */
  debugTriggerUpdate?: (pluginId: string, address: string) => Promise<void>
}

/** Callbacks from plugin to server */
export interface PluginCallbacks {
  onUpdate: (pluginId: string, address: string, checkpoint?: string) => void
  onSubLost: (pluginId: string, addresses: string[]) => void
}

/**
 * Factory object exported by each plugin.
 * Each plugin defines its own name and supported chain pluginIds.
 */
export interface PluginFactory {
  /** Unique name for this plugin (e.g., 'blockbook', 'evmRpc') */
  readonly name: string

  /** List of chain pluginIds this plugin supports */
  readonly chainPluginIds: string[]

  /** Create the plugin instance */
  makePlugin: (callbacks: PluginCallbacks) => Promise<PluginApi>
}
