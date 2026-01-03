# V2 Plugin Integration Tests

This directory contains integration tests for the v2 multi-process plugin architecture.

## Prerequisites

The v2 server must be running before executing integration tests:

```bash
yarn start.v2
```

## Running Tests

Run all integration tests:

```bash
yarn test:integration
```

Run specific test file:

```bash
yarn test:integration test/v2/evmrpcIntegration.test.ts
```

## Test Files

### `evmrpcIntegration.test.ts`

Integration tests for the EVM RPC plugin that verify:

1. **Single client subscription tests**
   - Subscribe to chains with checkpoint (triggers scan adapter)
   - Subscribe to multiple chains sequentially
   - Subscribe without checkpoint
   - Subscribe to unsupported plugin returns -1
   - Unsubscribe after subscribe

2. **Multiple client tests**
   - Multiple clients subscribing to the same address
   - Disconnect one client while others remain subscribed
   - Same client subscribes to same address twice (idempotency)

3. **Subscription lifecycle tests**
   - Subscribe, unsubscribe, re-subscribe cycle
   - Subscribe to multiple chains at once
   - Unsubscribe from addresses not subscribed to (no-op)

4. **Address scanning verification**
   - Checkpoint 0 triggers scan and returns appropriate result
   - Very high checkpoint returns result 1 (no changes)

### `checkAddressStatus.ts`

Standalone script to check address transaction history on various chains:

```bash
npx ts-node test/v2/checkAddressStatus.ts
```

This queries public Etherscan-compatible APIs to determine expected subscription results.

## Test Addresses

- `0x62Ed0197171174e03C2e1BA20299BAC8aF14bF10`
- `0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9`

## Subscription Result Codes

| Code | Meaning |
|------|---------|
| -1 | Not supported (plugin doesn't handle this chain) |
| 0 | Failed (error occurred) |
| 1 | Subscribed, no changes since checkpoint |
| 2 | Subscribed, changes present since checkpoint |

## Observing Server Logs

While running tests, monitor the server logs to verify:

- Address scanning: `scanAddress etherscanV2 found normal transactions`
- Subscription tracking: `numSubs` count changes on each block
- Connection lifecycle: `connected`, `subscribe`, `unsubscribe`, `closed` events
- Reference counting: `numSubs` returns to 0 after all clients disconnect

Example log entries:

```json
{"d":"...","s":"hub","connectionId":"...","ip":"127.0.0.1","t":"connected"}
{"d":"...","s":"hub","connectionId":"...","subs":[{"pluginId":"ethereum","addr":"0x62Ed"}],"t":"subscribe"}
{"d":"...","s":"evmrpc","cpid":"ethereum","t":"scanAddress etherscanV2 found normal transactions","numTxs":22}
{"d":"...","s":"evmrpc","cpid":"ethereum","blockNum":"24152213","numSubs":1}
{"d":"...","s":"hub","connectionId":"...","subs":[{"pluginId":"ethereum","addr":"0x62Ed"}],"t":"closed"}
```

