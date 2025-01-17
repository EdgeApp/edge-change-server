import type WebSocket from 'ws'

/**
 * Converts a message from the `ws` library to a string.
 */
export function messageToString(message: WebSocket.RawData): string {
  const buffer = Buffer.isBuffer(message)
    ? message
    : Array.isArray(message)
    ? Buffer.concat(message)
    : Buffer.from(message)
  return buffer.toString('utf-8')
}
