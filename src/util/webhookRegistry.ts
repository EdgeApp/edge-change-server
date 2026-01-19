import { HttpResponse, Serverlet } from 'serverlet'
import { ExpressRequest } from 'serverlet/express'

import { makeLogger } from './logger'

export type WebhookRoute = Serverlet<ExpressRequest>

export interface WebhookRegistry {
  /** Register a handler for a webhook key */
  registerHandler: (webhookKey: string, routeHandler: WebhookRoute) => void

  /** Unregister a handler for a webhook key */
  unregisterHandler: (webhookKey: string, routeHandler: WebhookRoute) => void

  /** Dispatch incoming webhook to handlers registered for the given key */
  handleWebhook: (
    webhookKey: string,
    request: ExpressRequest
  ) => HttpResponse | Promise<HttpResponse>
}

const OK_RESPONSE: HttpResponse = {
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'OK'
}

/**
 * Creates a registry for webhook handlers.
 * Plugins register their handlers here, and the HTTP server routes
 * incoming webhooks to the appropriate handlers by key.
 */
export function makeWebhookRegistry(): WebhookRegistry {
  const logger = makeLogger('webhook-registry')
  const routeHandlerMap = new Map<string, WebhookRoute[]>()

  return {
    registerHandler(webhookKey: string, routeHandler: WebhookRoute) {
      const routeHandlers = routeHandlerMap.get(webhookKey) ?? []
      routeHandlers.push(routeHandler)
      routeHandlerMap.set(webhookKey, routeHandlers)
      logger.info({ webhookKey, msg: 'Registered webhook route' })
    },

    unregisterHandler(webhookKey: string, routeHandler: WebhookRoute) {
      const routeHandlers = routeHandlerMap.get(webhookKey)
      if (routeHandlers == null) return
      const index = routeHandlers.indexOf(routeHandler)
      if (index !== -1) routeHandlers.splice(index, 1)
      if (routeHandlers.length === 0) routeHandlerMap.delete(webhookKey)
      logger.info({ webhookKey, msg: 'Unregistered webhook route' })
    },

    async handleWebhook(
      webhookKey: string,
      request: ExpressRequest
    ): Promise<HttpResponse> {
      const routeHandlers = routeHandlerMap.get(webhookKey)
      if (routeHandlers == null) return OK_RESPONSE

      for (const routeHandler of routeHandlers) {
        try {
          const response = await routeHandler(request)
          const status = response.status ?? 200
          if (status < 200 || status >= 300) {
            return response
          }
        } catch (err: unknown) {
          logger.error({ err, webhookKey, msg: 'Error in webhook route' })
          return {
            status: 500,
            headers: { 'content-type': 'text/plain' },
            body: 'Internal error'
          }
        }
      }
      return OK_RESPONSE
    }
  }
}
