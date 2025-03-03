import {
  asArray,
  asBoolean,
  asCodec,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue,
  Cleaner
} from 'cleaners'

import { JsonRpcCall, JsonRpcReturn, makeRpcProtocol } from '../jsonRpc'

// function asNullable<T>(cleaner: Cleaner<T>): Cleaner<T | null> {
//   return function asNullable(raw) {
//     if (raw == null) return raw
//     return cleaner(raw)
//   }
// }

export const blockbookProtocol = makeRpcProtocol({
  serverMethods: {
    getAccountInfo: {
      asParams: asObject({
        descriptor: asString, // Address or XPub
        details: asValue(
          'basic',
          'tokenBalances',
          'tokens',
          'txids',
          'txs',
          'txslight'
        ),
        tokens: asOptional(asValue('derived', 'nonzero', 'used')),
        page: asOptional(asNumber),
        pageSize: asOptional(asNumber),
        from: asOptional(asNumber), // Lowest block height, inclusive
        to: asOptional(asNumber), // Highest block height
        contractFilter: asOptional(asString), // For token queries
        secondaryCurrency: asOptional(asString), // For fiat balances
        gap: asOptional(asNumber) // Gap limit for xpub's
      }),
      asResult: asObject({
        address: asString,
        balance: asString,
        totalReceived: asString,
        totalSent: asString,
        unconfirmedBalance: asString,
        unconfirmedTxs: asNumber,
        txs: asNumber,
        // For paged queries:
        page: asOptional(asNumber),
        totalPages: asOptional(asNumber),
        itemsOnPage: asOptional(asNumber),
        transactions: asOptional(asArray(asUnknown)),
        txids: asOptional(asArray(asString))
      })
    },

    subscribeAddresses: {
      asParams: asObject({ addresses: asArray(asString) }),
      asResult: asObject({ subscribed: asBoolean })
    },

    unsubscribeAddresses: {
      asParams: asObject({ addresses: asArray(asString) }),
      asResult: asObject({ subscribed: asBoolean })
    }

    // estimateFee
    // getBalanceHistory
    // getBlockHash
    // getCurrentFiatRates
    // getFiatRatesForTimestamps
    // getFiatRatesTickersList
    // getInfo
    // getTransaction
    // getTransactionSpecific
    // sendTransaction
    // subscribeFiatRates
    // subscribeNewBlock
    // subscribeNewTransaction
    // unsubscribeFiatRates
    // unsubscribeNewBlock
    // unsubscribeNewTransaction
  },

  clientMethods: {
    subscribeAddresses: {
      asParams: asObject({ address: asString })
    }

    // subscribeFiatRates
    // subscribeNewBlock
    // subscribeNewTransaction
  },

  // Differences from JSON-RPC:
  // - There is no `jsonrpc` version field.
  // - The `id` cannot be a number, only a string.
  // - Responses come back with `data` instead of `result`.
  // - Subscription updates updates look like return values,
  //   but with the `id` as the method name.

  asCall: asCodec<JsonRpcCall>(
    raw => {
      // Blockbook notifications look like return values:
      const notification = asMaybe(asBlockbookReturn)(raw)
      if (notification != null && typeof notification.id === 'string') {
        return {
          jsonrpc: '2.0',
          method: notification.id,
          params: notification.data
        }
      }
      const { id, method, params } = asBlockbookCall(raw)
      return {
        id,
        jsonrpc: '2.0',
        method,
        params
      }
    },
    ({ id, method, params }) => ({
      id: String(id),
      method,
      params
    })
  ),

  asReturn: asCodec<JsonRpcReturn>(
    raw => {
      const { id, data } = asBlockbookReturn(raw)
      return {
        id,
        jsonrpc: '2.0',
        result: data
      }
    },
    ({ id, result }) => ({
      id: String(id),
      data: result
    })
  )
})

const asBlockbookId: Cleaner<string | number> = raw => {
  const clean = asString(raw)
  return /^[0-9]+$/.test(clean) ? parseInt(clean) : clean
}

const asBlockbookCall = asObject({
  id: asBlockbookId,
  method: asString,
  params: asUnknown
})

const asBlockbookReturn = asObject({
  id: asBlockbookId,
  data: asUnknown
})
