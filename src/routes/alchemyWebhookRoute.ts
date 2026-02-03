import crypto from 'crypto'
import { HttpResponse, Serverlet } from 'serverlet'

import { WebhookRegistryRequest } from '../middleware/withWebhookRegistry'
import { serverConfig } from '../serverConfig'
import { makeLogger } from '../util/logger'
import { AlchemyActivity, AlchemyWebhookPayload } from '../util/webhookRegistry'

export { AlchemyActivity, AlchemyWebhookPayload }

const logger = makeLogger('alchemy-webhook')

/**
 * Serverlet that processes Alchemy webhook payloads.
 * Validates signature, parses payload, and routes to the registry.
 */
export const alchemyWebhookRoute: Serverlet<WebhookRegistryRequest> = (
  request
): HttpResponse => {
  const { headers, webhookRegistry } = request
  const rawBody: string =
    typeof request.req.body === 'string' ? request.req.body : ''
  const signature = headers['x-alchemy-signature']

  // Validate signature
  if (typeof signature !== 'string') {
    logger.warn({ msg: 'Missing X-Alchemy-Signature header' })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Missing signature'
    }
  }

  if (!validateSignature(rawBody, signature)) {
    logger.warn({ msg: 'Invalid webhook signature' })
    return {
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Invalid signature'
    }
  }

  // Parse payload
  let payload: AlchemyWebhookPayload
  try {
    payload = JSON.parse(rawBody) as AlchemyWebhookPayload
  } catch (error) {
    logger.error({ err: error, msg: 'Failed to parse webhook payload' })
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: 'Invalid JSON'
    }
  }

  // Validate payload type
  if (payload.type !== 'ADDRESS_ACTIVITY') {
    logger.warn({ type: payload.type, msg: 'Unexpected webhook type' })
    return {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'OK'
    }
  }

  // Route to registry
  const network = payload.event.network
  webhookRegistry.handleWebhook(network, payload.event.activity)

  // Always respond 200 to acknowledge receipt
  return {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'OK'
  }
}

/**
 * Validates the webhook signature using HMAC-SHA256
 */
function validateSignature(rawBody: string, signature: string): boolean {
  const signingKey = serverConfig.alchemyWebhookSigningKey
  if (signingKey === '') {
    logger.error({ msg: 'Missing alchemyWebhookSigningKey in config' })
    return false
  }

  const hmac = crypto.createHmac('sha256', signingKey)
  hmac.update(rawBody, 'utf8')
  const expectedSignature = hmac.digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    // Lengths don't match
    return false
  }
}
