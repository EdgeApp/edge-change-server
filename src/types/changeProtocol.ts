import {
  asArray,
  asObject,
  asOptional,
  asString,
  asTuple,
  asValue,
  Cleaner
} from 'cleaners'

import { makeRpcProtocol } from '../jsonRpc'

/**
 * A chain and address identifier, like `['bitcoin', '19z88q...']`
 */
export type AddressTuple = [
  pluginId: string,
  address: string,

  /**
   * Block height or similar.
   * Might be missing the first time we scan an address.
   */
  checkpoint?: string
]

const asAddress = asTuple<AddressTuple>(
  asString,
  asString,
  asOptional(asString)
)

export type SubscribeResult =
  /** Subscribe failed */
  | 0
  /** Subscribe succeeded, no changes */
  | 1
  /** Subscribed succeeded, changes present */
  | 2
// export type SubscribeResult = boolean

const asSubscribeResult: Cleaner<SubscribeResult> = asValue(0, 1, 2)
// const asSubscribeResult: Cleaner<SubscribeResult> = asBoolean

export const changeProtocol = makeRpcProtocol({
  serverMethods: {
    subscribe: {
      asParams: asArray(asAddress),
      asResult: asArray(asSubscribeResult)
    },

    unsubscribe: {
      asParams: asArray(asAddress),
      asResult: asValue(undefined)
    }
  },

  clientMethods: {
    update: {
      asParams: asAddress
    },
    pluginConnect: {
      asParams: asObject({ pluginId: asString })
    },
    pluginDisconnect: {
      asParams: asObject({ pluginId: asString })
    }
  }
})

// core:
//   ws
//   codec
//   activePluginIds
//   subcriptions: Map<pluginID, address[]>
//
// 1. Core connects
// 2. Server sends pluginConnect
// 3. Core foreach pluginId with wallets, subscribe
// ...
// 1. Server sends pluginDisconnect
// 2. Core keeps updating subscriptions as if nothing happened
// 3. Server sends pluginConnect
