import { Serverlet } from 'serverlet'
import { ExpressRequest } from 'serverlet/express'

import { SigningKeyStore } from '../util/signingKeyStore'
import { WebhookRegistry } from '../util/webhookRegistry'

export interface WebhookRegistryRequest extends ExpressRequest {
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
}

export interface WithWebhookRegistryOptions {
  signingKeyStore: SigningKeyStore
  webhookRegistry: WebhookRegistry
}

/**
 * Middleware that adds webhookRegistry and signingKeyStore to the request context
 */
export const withWebhookRegistry = <T>(opts: WithWebhookRegistryOptions) => (
  serverlet: Serverlet<T & WebhookRegistryRequest>
): Serverlet<T & ExpressRequest> => {
  return request => {
    return serverlet({
      ...request,
      signingKeyStore: opts.signingKeyStore,
      webhookRegistry: opts.webhookRegistry
    })
  }
}
