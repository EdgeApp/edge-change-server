// src/v2/plugin/subscriptionState.ts
// Shared utilities for subscription tracking and deduplication

/**
 * Tracks subscriptions per pluginId with reference counting.
 * Handles deduplication when multiple connections subscribe to the same address.
 */
export interface PluginSubscriptionState {
  /** Maps normalized address to set of connectionIds */
  addressToConnections: Map<string, Set<string>>

  /** Maps connectionId to set of addresses (for cleanup on disconnect) */
  connectionToAddresses: Map<string, Set<string>>
}

export function makeSubscriptionState(): PluginSubscriptionState {
  return {
    addressToConnections: new Map(),
    connectionToAddresses: new Map()
  }
}

/**
 * Track a subscription (idempotent - duplicates ignored).
 * @returns true if this is a new address (first subscriber), false if already subscribed
 */
export function trackSubscription(
  state: PluginSubscriptionState,
  connectionId: string,
  address: string
): boolean {
  const normalizedAddr = address.toLowerCase()
  const isNewAddress = !state.addressToConnections.has(normalizedAddr)

  // Add to address → connections map
  let connections = state.addressToConnections.get(normalizedAddr)
  if (connections == null) {
    connections = new Set()
    state.addressToConnections.set(normalizedAddr, connections)
  }
  connections.add(connectionId)

  // Add to connection → addresses map
  let addresses = state.connectionToAddresses.get(connectionId)
  if (addresses == null) {
    addresses = new Set()
    state.connectionToAddresses.set(connectionId, addresses)
  }
  addresses.add(normalizedAddr)

  return isNewAddress
}

/**
 * Untrack a subscription (idempotent - missing ignored).
 * @returns true if address should be unsubscribed from RPC (no more refs)
 */
export function untrackSubscription(
  state: PluginSubscriptionState,
  connectionId: string,
  address: string
): boolean {
  const normalizedAddr = address.toLowerCase()

  // Remove from connection → addresses map
  const connAddresses = state.connectionToAddresses.get(connectionId)
  if (connAddresses != null) {
    connAddresses.delete(normalizedAddr)
    if (connAddresses.size === 0) {
      state.connectionToAddresses.delete(connectionId)
    }
  }

  // Remove from address → connections map
  const connections = state.addressToConnections.get(normalizedAddr)
  if (connections == null) return false

  connections.delete(connectionId)
  if (connections.size === 0) {
    state.addressToConnections.delete(normalizedAddr)
    return true // No more refs, can unsubscribe from RPC
  }
  return false
}

/**
 * Cleanup ALL subscriptions for a connection.
 * @returns array of addresses that should be unsubscribed from RPC (no more refs)
 */
export function cleanupConnection(
  state: PluginSubscriptionState,
  connectionId: string
): string[] {
  const addresses = state.connectionToAddresses.get(connectionId)
  if (addresses == null) return []

  const addressesToUnsubscribe: string[] = []

  for (const addr of addresses) {
    const connections = state.addressToConnections.get(addr)
    if (connections != null) {
      connections.delete(connectionId)
      if (connections.size === 0) {
        state.addressToConnections.delete(addr)
        addressesToUnsubscribe.push(addr) // No more refs, can unsubscribe from RPC
      }
    }
  }

  state.connectionToAddresses.delete(connectionId)
  return addressesToUnsubscribe
}

/**
 * Get all connectionIds subscribed to an address.
 */
export function getConnectionsForAddress(
  state: PluginSubscriptionState,
  address: string
): Set<string> | undefined {
  return state.addressToConnections.get(address.toLowerCase())
}

/**
 * Check if any connection is subscribed to an address.
 */
export function hasSubscribers(
  state: PluginSubscriptionState,
  address: string
): boolean {
  const connections = state.addressToConnections.get(address.toLowerCase())
  return connections != null && connections.size > 0
}
