import { Serverlet } from 'serverlet'
import { ExpressRequest } from 'serverlet/express'

/**
 * Health check response for webhook URL validation.
 * Alchemy sends GET/HEAD requests to verify webhook URLs are reachable.
 */
export const healthCheckRoute: Serverlet<ExpressRequest> = () => ({
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'OK'
})
