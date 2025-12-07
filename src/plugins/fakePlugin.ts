import { makeEvents } from 'yavent'

import { AddressPlugin, PluginEvents } from '../types/addressPlugin'

export function makeFakePlugin(): AddressPlugin {
  const [on, emit] = makeEvents<PluginEvents>()

  // Track pending timeouts so they can be cancelled on unsubscribe
  const pendingTimeouts = new Map<string, NodeJS.Timeout>()

  return {
    pluginId: 'fake',
    on,

    async subscribe(address) {
      // Clear any existing timeout for this address to prevent leaks on re-subscribe
      const existingTimeout = pendingTimeouts.get(address)
      if (existingTimeout != null) {
        clearTimeout(existingTimeout)
      }
      const timeout = setTimeout(() => {
        pendingTimeouts.delete(address)
        emit('update', { address })
      }, 1000)
      pendingTimeouts.set(address, timeout)
      return true
    },

    async unsubscribe(address) {
      const timeout = pendingTimeouts.get(address)
      if (timeout != null) {
        clearTimeout(timeout)
        pendingTimeouts.delete(address)
      }
      return true
    },

    async scanAddress(address, checkpoint): Promise<boolean> {
      return false
    },

    destroy() {
      // Clear all pending timeouts
      for (const timeout of pendingTimeouts.values()) {
        clearTimeout(timeout)
      }
      pendingTimeouts.clear()
    }
  }
}
