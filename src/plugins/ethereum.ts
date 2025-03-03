import { AddressPlugin } from '../types/addressPlugin'

export function makeEthereum(opts: {}): AddressPlugin {
  return {
    pluginId: 'ethereum',

    on(event, callback) {
      return () => {}
    },

    subscribe() {},

    unsubscribe(address) {}
  }
}
