# Change Server Logging

## Implementation

Uses Pino with a base logger and child loggers for scoping. Located in `src/util/logger.ts`.

### API

```typescript
import { logger, makeLogger } from './util/logger'

// Direct use of base logger for simple cases:
logger.info({ port: 3000 }, 'server started')

// For code plugins (blockbook, evmRpc):
const pluginLogger = makeLogger('blockbook', 'ethereum') // scope, chainPluginId

// For non-plugin code:
const socketLogger = makeLogger('socket') // scope only

// Returns a pino.Logger - use standard Pino API:
pluginLogger.info('message')
pluginLogger.warn('message')
pluginLogger.error('message')

// Pass an object with extra fields:
pluginLogger.info({ ip: '1.2.3.4' }, 'connected')
pluginLogger.info({ blockNum: '12345' }, 'block')
```

### Output Format

JSON with these fields:

- `level` - numeric level (30=info, 40=warn, 50=error)
- `time` - numeric epoch milliseconds
- `scope` - scope identifier (code plugin name: "blockbook", "evmRpc", "socket", "server")
- `chainPluginId` - chain plugin ID (optional, e.g., "ethereum", "arbitrum")
- `pid` - process ID (for socket events)
- `sid` - socket ID (for socket events, identifies the connection)
- `msg` - text message (Pino default key)
- Additional fields from passed objects

Example:

```json
{"level":30,"time":1735654281000,"scope":"blockbook","chainPluginId":"bitcoin","blockNum":"876543","msg":"block"}
{"level":30,"time":1735654281000,"scope":"socket","pid":20812,"sid":396,"ip":"192.168.1.1","msg":"connected"}
{"level":50,"time":1735654281000,"scope":"evmRpc","chainPluginId":"ethereum","msg":"watchBlocks error: connection timeout"}
```

### pino-pretty Support

Logs are compatible with pino-pretty for human-readable output during development:

```bash
node src/index.js | pino-pretty --translateTime
# Or use -t shorthand:
node src/index.js | pino-pretty -t
```

## Logged Events

1. **WebSocket connection established** - scope: `socket`, includes pid, sid, IP
2. **Addresses subscribed** - scope: `socket`, includes pid, sid, IP, first 6 chars of addresses, pluginId, checkpoint
3. **Block found** - scope: code plugin, includes `chainPluginId`, block number
4. **Transaction detected** - scope: code plugin, includes `chainPluginId`, first 6 chars of address and txid
5. **Update sent** - scope: `socket`, includes pid, sid, IP, pluginId, address (6 chars), checkpoint

## Notes

- All output goes to stdout for logrotate compatibility
- Uses Pino's `.child()` pattern for efficient scoped logging
- Logging is disabled when `NODE_ENV=test`
- Reserved fields (`time`, `scope`) passed in log objects are automatically renamed with a `_` suffix to avoid conflicts (e.g., `time` becomes `time_`)
