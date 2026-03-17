# Adding A Plugin

This guide is the basic blueprint for adding a new address plugin to the change server. It focuses on the common structure shared by polling plugins, RPC plugins, websocket plugins, and webhook plugins.

## What A Plugin Must Do

Every plugin implements `AddressPlugin` from `src/types/addressPlugin.ts`.

That means it must provide:

- a stable `pluginId`
- an `on()` event emitter
- `subscribe(address)`
- `unsubscribe(address)`

It may also provide:

- `scanAddress(address, checkpoint)` if the plugin can check for changes on demand
- `destroy()` if the plugin owns timers, sockets, route handlers, or other resources

The only event most plugins emit is:

- `update: { address, checkpoint? }`

That event tells the hub that a client should rescan that address. The plugin does not describe what changed.

## Files You Usually Need

Most new plugins touch at least these files:

- `src/plugins/<pluginName>.ts`: the plugin implementation
- `src/plugins/allPlugins.ts`: registration in the server
- `test/plugins/<pluginName>.test.ts`: unit tests

Some plugins also need:

- `src/util/...`: provider-specific API wrappers, scan adapters, or shared helpers
- `src/serverConfig.ts` and `changeServerConfig.json`: config or credentials
- `CHANGELOG.md`: if the repo's release workflow expects a visible feature note

## Minimal Plugin Shape

Use this as the starting point for a new plugin:

```ts
import { makeEvents } from 'yavent'

import { AddressPlugin, PluginEvents } from '../types/addressPlugin'
import { makeLogger } from '../util/logger'

export interface ExamplePluginOptions {
  pluginId: string
  normalizeAddress?: (address: string) => string
}

export function makeExamplePlugin(opts: ExamplePluginOptions): AddressPlugin {
  const { pluginId, normalizeAddress = address => address } = opts

  const [on, emit] = makeEvents<PluginEvents>()
  const logger = makeLogger('example', pluginId)

  const subscribedAddresses = new Map<string, string>()

  return {
    pluginId,
    on,

    async subscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)
      if (subscribedAddresses.has(normalized)) return true

      subscribedAddresses.set(normalized, address)
      logger.info({ address }, 'Subscribed address')
      return true
    },

    async unsubscribe(address: string): Promise<boolean> {
      const normalized = normalizeAddress(address)
      if (!subscribedAddresses.has(normalized)) return false

      subscribedAddresses.delete(normalized)
      logger.info({ address }, 'Unsubscribed address')
      return true
    },

    async scanAddress(
      address: string,
      checkpoint?: string
    ): Promise<boolean> {
      return false
    },

    destroy() {
      subscribedAddresses.clear()
    }
  }
}
```

Once the provider integration exists, the plugin's job is just to map provider activity into `emit('update', { address, checkpoint })`.

## How Plugins Fit Into The Server

The wiring is:

1. `makeAllPlugins()` creates plugin instances.
2. `makeAddressHub()` subscribes clients to plugins by `pluginId`.
3. The hub listens for plugin `update` events.
4. The hub forwards those updates to subscribed websocket clients.

That means a plugin should:

- keep its own provider-facing state
- emit updates for addresses it is actually tracking
- avoid leaking provider-specific details outside the plugin boundary

## Registering The Plugin

Add the factory call to `src/plugins/allPlugins.ts`.

Typical patterns:

- one plugin instance per chain
- one shared implementation with different `pluginId` or network options
- injected helpers like `notifyApi`, `signingKeyStore`, or `webhookRegistry`

Keep `pluginId` stable. Clients use it to subscribe.

## Design Questions To Answer First

Before you write code, decide:

- What external system detects the change: polling, RPC subscriptions, websocket stream, or webhooks?
- Do addresses need normalization for matching?
- Can the provider return a useful checkpoint like block height?
- Can the plugin do `scanAddress()`, or must the client rescan unconditionally?
- What state must survive restarts?
- What resources must be cleaned up in `destroy()`?

These choices strongly affect the implementation.

## Address Handling

Most plugins need normalized lookup keys and original addresses for emitted updates.

Recommended pattern:

- store subscriptions by normalized address
- preserve the original subscribed address when emitting `update`
- make normalization injectable when the same implementation supports multiple chains

Examples:

- EVM addresses are usually matched with lowercase
- Solana/base58-style addresses are case-sensitive
- Bitcoin-like addresses often should not be rewritten unless the provider requires it

## Checkpoints

If the provider exposes a reliable height or cursor, include it in the emitted update:

```ts
emit('update', {
  address: originalAddress,
  checkpoint: blockHeight.toString()
})
```

If not, emit the update without a checkpoint and let the client decide how much to rescan.

## Error Handling

A plugin should be conservative about local state:

- only mark a subscribe as active once the remote subscribe succeeds
- preserve local state when remote unsubscribe fails, unless the provider guarantees the resource is gone
- retry only clearly transient failures
- log enough context to debug provider issues

If the provider can silently lose subscriptions, consider whether the plugin should emit `subLost`.

## Testing Checklist

Every plugin should have tests for:

- instantiation
- `pluginId`
- subscribe idempotency
- unsubscribe behavior
- tracked vs untracked address updates
- checkpoint behavior
- failure paths for provider calls
- cleanup in `destroy()`

Add provider-specific tests as needed:

- retry/backoff
- connection recovery
- payload validation
- address normalization
- startup reconciliation
- duplicate delivery handling

## When To Use The Webhook Guide

If the provider pushes activity into `/webhook/...`, also follow `docs/webhook-based-plugins.md`.
