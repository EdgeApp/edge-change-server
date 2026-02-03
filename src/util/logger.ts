import pino from 'pino'

export type Logger = pino.Logger

// Single base logger instance
export const logger = pino({
  enabled: process.env.NODE_ENV !== 'test',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    log(object) {
      const { time, scope, ...rest } = object
      return {
        ...rest,
        ...(time != null
          ? { "Warning: 'time' field because it's reserved for Pino": time }
          : {}),
        ...(scope != null
          ? {
              "Warning: 'scope' field because it's reserved for logging context": scope
            }
          : {})
      }
    }
  }
})

/**
 * Creates a scoped logger using Pino's .child() pattern.
 * Adds a "scope" field to identify the logging context (e.g., "blockbook", "evmRpc", "socket").
 *
 * @param scope - The scope identifier
 * @param chainPluginId - Optional chain plugin ID (e.g., "ethereum", "arbitrum")
 */
export function makeLogger(scope: string, chainPluginId?: string): Logger {
  return logger.child({
    scope,
    ...(chainPluginId != null ? { chainPluginId } : {})
  })
}
