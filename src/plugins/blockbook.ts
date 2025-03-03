import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { messageToString } from '../messageToString'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { blockbookProtocol } from '../types/blockbookProtocol'

export interface BlockbookOptions {
  pluginId: string

  /** The actual connection URL */
  url: string
}

export function makeBlockbook(opts: BlockbookOptions): AddressPlugin {
  const { pluginId, url } = opts

  const ws = new WebSocket(url)
  const [on, emit] = makeEvents<PluginEvents>()
  const codec = blockbookProtocol.makeClientCodec({
    handleError(error) {
      emit('error', error)
    },
    async handleSend(text) {
      ws.send(text)
    },
    localMethods: {
      subscribeAddresses({ address }) {
        emit('update', { address })
      }
    }
  })

  ws.on('message', message => {
    const text = messageToString(message)
    codec.handleMessage(text)
  })
  ws.on('open', () => {
    emit('connect', undefined)
  })
  ws.on('close', () => {
    codec.handleClose()
    emit('disconnect', undefined)
  })
  ws.on('error', error => {
    emit('error', error)
  })

  return {
    pluginId,
    on,

    async subscribe(address) {
      const result = await codec.remoteMethods.subscribeAddresses({
        addresses: [address]
      })
      return result.subscribed
    },

    async unsubscribe(address) {
      const result = await codec.remoteMethods.unsubscribeAddresses({
        addresses: [address]
      })
      return result.subscribed
    },

    async scanAddress(address, checkpoint): Promise<boolean> {
      const out = await codec.remoteMethods.getAccountInfo({
        descriptor: address,
        details: 'txids',
        tokens: undefined,
        from: checkpoint == null ? checkpoint : parseInt(checkpoint),
        to: undefined,
        page: undefined,
        pageSize: undefined,
        contractFilter: undefined,
        secondaryCurrency: undefined,
        gap: undefined
      })

      if (out.unconfirmedTxs > 0) return true
      if (out.txids != null && out.txids.length > 0) return true
      return false
    },

    destroy() {
      ws.close()
    }
  }
}
