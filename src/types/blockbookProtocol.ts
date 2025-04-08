import {
  asArray,
  asBoolean,
  asCodec,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUndefined,
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
        totalReceived: asOptional(asString),
        totalSent: asOptional(asString),
        unconfirmedBalance: asString,
        unconfirmedTxs: asNumber,
        txs: asNumber,
        // For paged queries:
        page: asOptional(asNumber),
        totalPages: asOptional(asNumber),
        itemsOnPage: asOptional(asNumber),
        transactions: asOptional(
          asArray(
            asObject({
              txid: asString,
              blockHeight: asNumber,
              confirmations: asNumber
              // ...Other fields omitted for brevity (they're not needed)
            })
          )
        ),
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
    },

    ping: {
      asParams: asUndefined,
      asResult: asObject({})
    },

    subscribeNewBlock: {
      asParams: asUndefined,
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
    // subscribeNewTransaction
    // unsubscribeFiatRates
    // unsubscribeNewBlock
    // unsubscribeNewTransaction
  },

  clientMethods: {
    subscribeAddresses: {
      asParams: asObject({
        address: asString,
        tx: asObject({
          txid: asString,
          // hex: asString,
          blockHeight: asNumber,
          confirmations: asNumber,
          blockTime: asNumber,
          fees: asString
          // vin: asArray(
          //   asObject({
          //     addresses: asOptional(asArray(asString), () => []),
          //     // `isAddress` is a boolean flag that indicates whether the input is an address.
          //     // And therefore has `addresses` field. If `isAddress` is false, then the input is likely a coinbase input.
          //     isAddress: asBoolean,
          //     // This is the index of the input. Not to be confused with the index of the previous output (vout).
          //     n: asNumber,
          //     // Empirically observed omitted sequence is possible for when sequence is zero.
          //     // Is the case for tx `19ecc679cfc7e71ad616a22bbee96fd5abe8616e4f408f1f5daaf137400ae091`.
          //     sequence: asOptional(asNumber, 0),
          //     txid: asOptional(asString),
          //     value: asOptional(asString, '0'),
          //     // If Blockbook doesn't provide vout, assume 0. Empirically observed
          //     // case for tx `fefac8c22ba1178df5d7c90b78cc1c203d1a9f5f5506f7b8f6f469fa821c2674`
          //     // which has no `vout` for input in WebSocket response payload but block
          //     // will show the input's vout value to be `0`.
          //     vout: asOptional(asNumber, 0),
          //     coinbase: asOptional(asString),
          //     isOwn: asOptional(asBoolean),
          //     hex: asOptional(asString),
          //     asm: asOptional(asString)
          //   })
          // ),
          // vout: asArray(
          //   asObject({
          //     n: asNumber,
          //     value: asString,
          //     addresses: asArray(asString),
          //     hex: asOptional(asString)
          //   })
          // )
        })
      })
    },

    subscribeNewBlock: {
      asParams: asObject({
        height: asNumber,
        hash: asString
      })
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

type BlockbookProtocol = typeof blockbookProtocol
export type BlockbookProtocolServer = ReturnType<
  BlockbookProtocol['makeServerCodec']
>
export type BlockbookProtocolClient = ReturnType<
  BlockbookProtocol['makeClientCodec']
>

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
