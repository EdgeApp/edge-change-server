import { makeEvents } from 'yavent'

import { AddressPlugin, PluginEvents } from '../types/addressPlugin'

export function makeFakePlugin(): AddressPlugin {
  const [on, emit] = makeEvents<PluginEvents>()

  return {
    pluginId: 'fake',
    on,

    subscribe(address) {
      setTimeout(() => {
        emit('update', { address })
      }, 1000)
    },

    unsubscribe(address) {},

    async scanAddress(address, checkpoint): Promise<boolean> {
      return false
    },

    destroy() {}
  }
}
