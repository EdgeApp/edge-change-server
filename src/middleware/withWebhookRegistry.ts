import { Serverlet } from 'serverlet'
import { ExpressRequest } from 'serverlet/express'

import { WebhookRegistry } from '../util/webhookRegistry'

export interface WebhookRegistryRequest extends ExpressRequest {
  webhookRegistry: WebhookRegistry
}

/**
 * Middleware that adds webhookRegistry to the request context
 */
export const withWebhookRegistry = <T>(webhookRegistry: WebhookRegistry) => (
  serverlet: Serverlet<T & WebhookRegistryRequest>
): Serverlet<T & ExpressRequest> => {
  return request => {
    return serverlet({
      ...request,
      webhookRegistry
    })
  }
}
