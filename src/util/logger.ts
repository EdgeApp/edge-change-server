import winston from 'winston'
import TransportStream from 'winston-transport'

// Custom transport that uses console.log for testability
class ConsoleLogTransport extends TransportStream {
  log(info: { [key: string | symbol]: string }, callback: () => void): void {
    // Winston stores formatted output in Symbol.for('message')
    const formatted = info[Symbol.for('message')]
    console.log(formatted)
    callback()
  }
}

export interface LogData {
  [key: string]: unknown
}

export interface Logger {
  (message: string | LogData): void
  warn: (message: string | LogData) => void
  error: (message: string | LogData) => void
}

// Custom format that outputs our JSON structure: {d, s, cpid?, t|...data, l?}
const customFormat = (scope: string, cpid?: string): winston.Logform.Format =>
  winston.format.printf(({ level, message, ...rest }) => {
    const d = new Date().toISOString()
    const obj: Record<string, unknown> = { d, pid: process.pid, s: scope }

    if (cpid != null) obj.cpid = cpid

    // If message is a string, use 't' key
    if (typeof message === 'string') {
      obj.t = message
    } else if (typeof message === 'object' && message != null) {
      // Spread object data (validate no d or s)
      if ('d' in message || 's' in message) {
        return JSON.stringify({
          d,
          pid: process.pid,
          s: scope,
          l: 'error',
          t: 'Logger error: caller object cannot contain "d" or "s" keys'
        })
      }
      Object.assign(obj, message)
    }

    // Spread any additional metadata from rest
    const { splat, ...metadata } = rest
    Object.assign(obj, metadata)

    // Add level for warn/error
    if (level === 'warn' || level === 'error') {
      obj.l = level
    }

    return JSON.stringify(obj)
  })

/**
 * Creates a scoped logger that outputs JSON format using Winston.
 * Output format: {"d": "timestamp", "s": "scope", "t": "message"} or {"d": "timestamp", "s": "scope", ...data}
 *
 * @param scope - The scope identifier (e.g., "blockbook", "evmRpc", "socket")
 * @param cpid - Optional chain plugin ID (e.g., "ethereum", "arbitrum")
 */
export function makeLogger(scope: string, cpid?: string): Logger {
  const winstonLogger = winston.createLogger({
    levels: { error: 0, warn: 1, info: 2 },
    level: 'info',
    format: customFormat(scope, cpid),
    transports: [new ConsoleLogTransport()]
  })

  const logMessage = (
    level: 'info' | 'warn' | 'error',
    message: string | LogData
  ): void => {
    if (typeof message === 'string') {
      winstonLogger.log(level, message)
    } else {
      // For objects, pass as the message itself
      winstonLogger.log(level, (message as unknown) as string)
    }
  }

  const log = (message: string | LogData): void => {
    logMessage('info', message)
  }

  log.warn = (message: string | LogData): void => {
    logMessage('warn', message)
  }

  log.error = (message: string | LogData): void => {
    logMessage('error', message)
  }

  return log
}
