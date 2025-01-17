import {
  asArray,
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
  /** Subscribe failed (unsupported chain) */
  | 0
  /** Subscribe succeeded, no changes */
  | 1
  /** Subscribed succeeded, changes present */
  | 2

const asSubscribeResult: Cleaner<SubscribeResult> = asValue(0, 1, 2)

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
    }
  }
})
