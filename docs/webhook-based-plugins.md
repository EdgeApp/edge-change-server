# Writing A Webhook-Based Plugin

This guide explains how to implement a plugin that receives address activity through `/webhook/...` instead of polling or maintaining a long-lived upstream socket.

Use this together with `docs/adding-a-plugin.md`.

## When A Webhook Plugin Is A Good Fit

Choose a webhook-based plugin when the provider:

- can push address activity to a callback URL
- can create or update remote subscriptions on demand
- includes enough information in the payload to emit `update`
- has a security model the server can validate locally

As of this writing, `Alchemy` and `Tatum` are the two working examples in this repo.

## Pick The Provider Model First

Before writing code, decide which of these models the provider uses:

- one shared webhook per chain/network with a mutable address list
- one remote subscription per address

That choice drives almost every design decision.

Shared-webhook providers behave more like `Alchemy`:

- local state tracks one `webhookId`
- subscribe/unsubscribe mutates the provider's address list
- batching is usually important
- multi-worker fanout matters because one webhook delivery can apply to many addresses

Per-address providers behave more like `Tatum`:

- local state maps address to provider subscription id
- subscribe/unsubscribe creates and deletes remote resources
- retries often matter more than batching
- duplicate deliveries are more likely to need explicit deduplication

## Basic Structure

A webhook plugin usually needs:

- a factory in `src/plugins/<name>.ts`
- a `webhookKey`
- a route handler registered with `WebhookRegistry`
- local subscription state
- provider API helpers

The high-level shape looks like this:

```ts
import crypto from 'crypto'
import { makeEvents } from 'yavent'

import { serverConfig } from '../serverConfig'
import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { makeLogger } from '../util/logger'
import { WebhookRegistry, WebhookRoute } from '../util/webhookRegistry'

export interface ExampleWebhookOptions {
  pluginId: string
  webhookRegistry: WebhookRegistry
  normalizeAddress?: (address: string) => string
}

export function makeExampleWebhookPlugin(
  opts: ExampleWebhookOptions
): AddressPlugin {
  const {
    pluginId,
    webhookRegistry,
    normalizeAddress = address => address
  } = opts

  const [on, emit] = makeEvents<PluginEvents>()
  const logger = makeLogger('exampleWebhook', pluginId)

  const WEBHOOK_KEY = `example/${pluginId}`
  const WEBHOOK_URL = `${serverConfig.publicUri}/webhook/${WEBHOOK_KEY}`
  const subscribedAddresses = new Map<string, string>()

  const webhookRoute: WebhookRoute = async request => {
    const rawBody = typeof request.req.body === 'string' ? request.req.body : ''

    // 1. authenticate raw body
    // 2. parse payload
    // 3. map provider activity to tracked addresses
    // 4. emit update events

    return {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'OK'
    }
  }

  webhookRegistry.registerHandler(WEBHOOK_KEY, webhookRoute)

  return {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)
      subscribedAddresses.set(normalized, address)
      return true
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)
      return subscribedAddresses.delete(normalized)
    },

    destroy() {
      webhookRegistry.unregisterHandler(WEBHOOK_KEY, webhookRoute)
      subscribedAddresses.clear()
    }
  }
}
```

The rest of the work is about making each step production-safe.

## Step 1: Define The Callback URL

Always derive the callback URL from `serverConfig.publicUri`:

```ts
const WEBHOOK_KEY = `provider/${pluginId}`
const EXPECTED_WEBHOOK_URL = `${serverConfig.publicUri}/webhook/${WEBHOOK_KEY}`
```

Do not hard-code provider callback URLs anywhere else.

### Critical: Define The Ownership Boundary

This deserves to be treated as a separate design requirement, not a small implementation detail.

When the provider account is shared by multiple deployments, a webhook plugin must not reuse, update, or delete remote resources unless it can prove they belong to the current server instance.

If this boundary is wrong, the plugin can:

- steal another deployment's webhook or subscription
- rewrite a callback URL that belongs to a different server
- delete another deployment's remote resource during cleanup
- create hard-to-debug delivery gaps where webhooks are accepted but routed to the wrong server

Recommended checks:

- match the provider webhook/subscription type
- match the chain or network
- require the remote callback URL to belong to this server namespace

In practice, this usually means "only manage resources whose callback URL matches the current `publicUri` namespace".

Both existing webhook plugins rely on this safeguard:

- `Alchemy` only manages webhooks whose callback URL exactly matches the expected URL for this deployment
- `Tatum` only reuses subscriptions whose callback URL belongs to this server namespace, even when repairing stale paths

If a provider does not give enough metadata to establish ownership safely, prefer creating new isolated resources over mutating ambiguous existing ones.

## Step 2: Reconcile Remote State On Startup

A webhook plugin should initialize itself by looking at provider-side state before it handles normal traffic.

Typical startup work:

- list existing remote webhooks or subscriptions
- reuse the matching active resource if possible
- delete paused or duplicate resources if appropriate
- repair stale callback URLs if the provider allows it
- recover metadata needed to validate future deliveries

Two examples from the current codebase:

- `Alchemy` reuses an existing active webhook for the same URL and deletes extras
- `Tatum` discovers per-address subscriptions and updates stale callback URLs to the current endpoint

> [!IMPORTANT]  
> Keep startup idempotent. Initialization should be safe to run more than once without creating duplicate remote resources, deleting the wrong resource, or drifting local state away from provider state.

## Step 3: Subscribe And Unsubscribe Conservatively

`subscribe()` and `unsubscribe()` should keep local state aligned with remote state.

For subscribe:

- normalize the address
- short-circuit if already subscribed
- create or update the remote provider resource
- only mark the address active locally once the provider call succeeds

For unsubscribe:

- return `false` if the address is unknown
- delete or update the remote provider resource
- only clear local state when the provider confirms success, or when a `404`/equivalent proves the resource is already gone

If the provider API is rate-limited:

- batch address changes for shared-webhook providers
- retry transient failures for per-address providers

## Step 4: Authenticate The Incoming Webhook From The Raw Body

Webhook signatures must be validated against the exact raw request body. This server already uses `express.text({ type: '*/*' })` in the worker so plugins can read the unmodified body string.

Recommended flow inside the route handler:

1. read `request.req.body` as a string
2. read the provider signature header
3. fetch the relevant secret or signing key
4. compute the expected HMAC
5. compare with `crypto.timingSafeEqual`
6. reject failures with `401`

Do authentication before trusting network ids, webhook ids, or payload contents any more than necessary.

## Step 5: Parse And Validate Payloads Strictly

After signature verification, parse the payload with cleaners and reject malformed data early.

Recommended approach:

- parse from the raw JSON string
- require only the fields the plugin actually uses
- return `400` for invalid but authenticated payloads
- log enough context to debug bad payloads without leaking secrets

If the provider can send multiple event types to the same endpoint, validate the event type explicitly before processing.

## Step 6: Map Provider Activity To Tracked Addresses

Once the payload is trusted, convert provider activity into `update` events.

Good patterns:

- normalize provider addresses for matching
- preserve the original subscribed address when emitting
- collect affected addresses into a `Set` before emitting
- derive the best checkpoint available from the payload

Examples:

- `Alchemy` scans the batch for matching `fromAddress` and `toAddress`, then emits one update per matched address with the highest block number
- `Tatum` emits the payload address with `blockNumber` when present

Only emit updates for addresses currently tracked by the plugin.

## Step 7: Decide On Duplicate Handling

Webhook delivery is often at-least-once.

You need an explicit answer to this question: what happens if the same event is delivered twice?

Options:

- ignore duplicates because repeated `update` events are harmless
- track processed event ids or tx ids in memory
- persist deduplication state if replay after restart would be costly

`Tatum` uses `txId` deduplication. `Alchemy` currently accepts the risk of repeated updates because the downstream effect is just "rescan this address".

Do not skip this decision. Make it deliberate.

## Step 8: Handle Multi-Worker Delivery

This server may run more than one worker. A webhook can be received by a worker that does not hold the websocket subscriptions for the affected addresses.

If your plugin stores subscription state only in process memory, you need a delivery strategy:

- broadcast activity across workers, like `Alchemy`
- move subscription state into shared storage
- ensure webhook traffic is pinned to a single worker

Without one of these, valid webhooks may be acknowledged but never forwarded to clients.

This is the biggest operational difference between "webhook works locally" and "webhook works in production".

## Step 9: Add Retry And Backoff Where It Matters

Webhook plugins make two kinds of network calls:

- provider control-plane calls such as create/update/delete webhook
- optional data-plane calls such as fallback scans or metadata lookup

At minimum, decide:

- which errors are retryable
- whether `429` should always back off
- how many attempts are allowed
- whether failed operations should be re-queued

The existing patterns are:

- `Alchemy`: debounce and retry address mutations later
- `Tatum`: retry create/update/delete with exponential backoff

## Step 10: Keep `destroy()` Honest

`destroy()` should clean up local resources and route registration.

Usually that means:

- unregister the webhook route
- clear timers
- remove IPC listeners
- clear caches or in-memory maps

Remote provider cleanup is a design choice, not an automatic requirement.

Examples:

- `Alchemy` removes the remote webhook only when there are no addresses left
- `Tatum` does not delete remote subscriptions during `destroy()`

Pick one lifecycle model and document it in the plugin.

## Webhook-Specific Test Checklist

A webhook plugin should have tests for:

- handler registration with the expected `webhookKey`
- subscribe/unsubscribe idempotency
- startup reconciliation
- ownership boundaries
- missing signature
- invalid signature
- malformed payload
- unexpected event type or network mismatch
- duplicate delivery behavior
- update emission for tracked addresses
- no update emission for untracked addresses
- cleanup in `destroy()`

If the plugin uses clustering or IPC, add tests for that too.

## Two Practical Templates

Use `Alchemy` as the template when the provider gives you:

- one webhook resource per network
- mutable address membership
- per-webhook signing keys
- clustered delivery concerns

Use `Tatum` as the template when the provider gives you:

- one subscription per address
- a stable event or transaction id
- provider APIs that need retry/backoff
- an optional scan endpoint for checkpoint-aware verification

If a new provider falls somewhere in the middle, choose the closer model and copy only the parts that actually match the provider's behavior.
