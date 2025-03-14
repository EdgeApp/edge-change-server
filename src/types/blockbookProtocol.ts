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

export const blockbookProtocol = makeRpcProtocol({
  allowMultipleReturns: true,

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
  // - Subscription updates re-use the same id as the original subscribe call.
  // - Errors also come back in `data` instead of `error`.

  asCall: asCodec<JsonRpcCall>(
    raw => {
      const { id, method, params } = asBlockbookCall(raw)
      return {
        id,
        jsonrpc: '2.0',
        method,
        params
      }
    },
    rpcCall => {
      return {
        id: rpcCall.id == null ? undefined : String(rpcCall.id),
        method: rpcCall.method,
        params: rpcCall.params
      }
    }
  ),

  asReturn: asCodec<JsonRpcReturn>(
    raw => {
      const blockbookReturn = asBlockbookReturn(raw)
      const blockbookError = asMaybe(asBlockbookError)(blockbookReturn.data)
      if (blockbookError != null) {
        return {
          id: blockbookReturn.id,
          jsonrpc: '2.0',
          error: {
            code: -1,
            message: blockbookError.error.message
          },
          result: undefined
        }
      }
      return {
        id: blockbookReturn.id,
        jsonrpc: '2.0',
        result: blockbookReturn.data
      }
    },
    rpcReturn => {
      const data =
        rpcReturn.error != null ? { error: rpcReturn.error } : rpcReturn.result
      return {
        id: rpcReturn.id == null ? undefined : String(rpcReturn.id),
        data
      }
    }
  )
})

const asBlockbookId: Cleaner<string | number> = raw => {
  const clean = asString(raw)
  return /^[0-9]+$/.test(clean) ? parseInt(clean) : clean
}

const asBlockbookCall = asObject({
  id: asOptional(asBlockbookId),
  method: asString,
  params: asUnknown
})

const asBlockbookReturn = asObject({
  id: asBlockbookId,
  data: asUnknown
})

const asBlockbookError = asObject({
  error: asObject({
    message: asString
  })
})
