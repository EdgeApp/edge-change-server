import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { messageToString } from '../messageToString'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { blockbookProtocol } from '../types/blockbookProtocol'

export interface BlockbookOptions {
  pluginId: string

  /** A clean URL for logging */
  safeUrl?: string

  /** The actual connection URL */
  url: string
}

export function makeBlockbook(opts: BlockbookOptions): AddressPlugin {
  const { pluginId, url } = opts

  const ws = new WebSocket(url)
  const [on, emit] = makeEvents<PluginEvents>()
  const codec = blockbookProtocol.makeClientCodec({
    handleError(error) {
      console.log(error)
    },
    async handleSend(text) {
      console.log('send', text)
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
    console.log(text)
    codec.handleMessage(text)
  })
  ws.on('open', () => emit('connect', undefined))
  ws.on('close', () => {
    codec.handleClose()
    emit('disconnect', undefined)
  })

  return {
    pluginId,
    on,

    subscribe(address) {
      codec.remoteMethods
        .subscribeAddresses({ addresses: [address] })
        .catch(error => console.log(error))
    },

    unsubscribe(address) {
      codec.remoteMethods
        .unsubscribeAddresses({ addresses: [address] })
        .catch(error => console.log(error))
    },

    async scanAddress(address, checkpoint): Promise<boolean> {
      const out = await codec.remoteMethods.getAccountInfo({
        descriptor: address, // Address or xpub
        details: 'txids',
        tokens: undefined, // 'derived',
        from: 860728, // checkpoint == null ? checkpoint : parseInt(checkpoint),
        to: undefined, // checkpoint == null ? checkpoint : parseInt(checkpoint),
        page: undefined,
        pageSize: undefined,
        contractFilter: undefined,
        secondaryCurrency: undefined,
        gap: undefined
      })

      console.log(out)
      // return out.unconfirmedTxs > 0 || out.txids?.length > 0

      if (out.unconfirmedTxs > 0) return true
      if (out.txids != null && out.txids.length > 0) return true
      return false
    }
  }
}
