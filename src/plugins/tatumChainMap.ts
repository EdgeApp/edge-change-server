/**
 * Mapping from Edge plugin IDs to Tatum blockchain chain identifiers.
 *
 * Chain identifiers follow Tatum's naming convention (e.g. bitcoin-mainnet).
 * Used when creating ADDRESS_EVENT subscriptions via the Tatum v4 API.
 *
 * Reference: https://docs.tatum.io/reference/notifications-supported-chains
 *
 * Tatum plugins covered (7 total):
 *  - bitcoin         → bitcoin-mainnet
 *  - bitcoincash     → bch-mainnet
 *  - dogecoin        → doge-mainnet
 *  - litecoin        → litecoin-core-mainnet
 *  - ripple          → ripple-mainnet   (XRP)
 *  - tezos           → tezos-mainnet
 *  - tron            → tron-mainnet
 */
export const tatumChainMap: Readonly<Record<string, string>> = {
  bitcoin: 'bitcoin-mainnet',
  bitcoincash: 'bch-mainnet',
  dogecoin: 'doge-mainnet',
  litecoin: 'litecoin-core-mainnet',
  ripple: 'ripple-mainnet',
  tezos: 'tezos-mainnet',
  tron: 'tron-mainnet'
}

/** All plugin IDs managed by Tatum. */
export const TATUM_PLUGIN_IDS: readonly string[] = Object.keys(tatumChainMap)
