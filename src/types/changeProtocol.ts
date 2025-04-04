import { asArray, asOptional, asString, asTuple, asValue } from 'cleaners'

import { makeRpcProtocol } from '../jsonRpc'

/**
 * A chain and address identifier, like `['bitcoin', '19z88q...']`
 */
export type SubscribeParams = [
  pluginId: string,
  address: string,

  /**
   * Block height or similar.
   * Might be missing the first time we scan an address.
   */
  checkpoint?: string
]

const asSubscribeParams = asTuple<SubscribeParams>(
  asString, // pluginId
  asString, // address
  asOptional(asString) // checkpoint
)

export type SubscribeResult = ReturnType<typeof asSubscribeResult>
const asSubscribeResult = asValue(
  /** Subscribe failed; not supported */
  -1,
  /** Subscribe failed; some thing went wrong */
  0,
  /** Subscribe succeeded, no changes */
  1,
  /** Subscribed succeeded, changes present */
  2
)

export const changeProtocol = makeRpcProtocol({
  serverMethods: {
    subscribe: {
      asParams: asArray(asSubscribeParams),
      asResult: asArray(asSubscribeResult)
    },

    unsubscribe: {
      asParams: asArray(asSubscribeParams),
      asResult: asValue(undefined)
    }
  },

  clientMethods: {
    update: {
      asParams: asSubscribeParams
    },
    subLost: {
      asParams: asSubscribeParams
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
