import { HttpResponse, Serverlet } from 'serverlet'

import { WebhookRegistryRequest } from '../middleware/withWebhookRegistry'

/**
 * Generic webhook route that extracts the webhook key from the path
 * and dispatches to all registered handlers for that key.
 */
export const webhookRoute: Serverlet<WebhookRegistryRequest> = async (
  request
): Promise<HttpResponse> => {
  // Extract key from path: /webhook/alchemy → 'alchemy'
  const webhookKey = request.path.replace(/^\/webhook\//, '')
  return await request.webhookRegistry.handleWebhook(webhookKey, request)
}
