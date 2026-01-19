import { Serverlet } from 'serverlet'
import { ExpressRequest } from 'serverlet/express'

export const notFoundRoute: Serverlet<ExpressRequest> = () => ({
  status: 404,
  headers: { 'content-type': 'text/plain' },
  body: 'Not Found'
})
