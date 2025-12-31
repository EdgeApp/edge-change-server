# Change Server Logging

## Implementation

Uses Winston with a custom transport and format. Located in `src/util/logger.ts`.

### API

```typescript
import { makeLogger } from './util/logger'

// For code plugins (blockbook, evmRpc):
const logger = makeLogger('blockbook', 'ethereum')  // scope, chainPluginId

// For non-plugin code:
const logger = makeLogger('socket')  // scope only

logger('message')           // info level
logger.warn('message')      // warn level
logger.error('message')     // error level

// Or pass an object to add extra fields:
logger({ ip: '1.2.3.4', t: 'connected' })
logger({ blockNum: '12345', t: 'block' })
```

### Output Format

JSON with these fields:
- `d` - ISO timestamp
- `s` - scope (code plugin name: "blockbook", "evmRpc", "socket", "server")
- `cpid` - chain plugin ID (optional, e.g., "ethereum", "arbitrum")
- `pid` - process ID (for socket events)
- `sid` - socket ID (for socket events, identifies the connection)
- `t` - text message (when string is passed)
- `l` - level ("warn" or "error", omitted for info)
- Additional fields from passed objects

Example:
```json
{"d":"2025-12-31T14:31:21.000Z","s":"blockbook","cpid":"bitcoin","blockNum":"876543","t":"block"}
{"d":"2025-12-31T14:31:21.000Z","s":"socket","pid":20812,"sid":396,"ip":"192.168.1.1","t":"connected"}
{"d":"2025-12-31T14:31:21.000Z","s":"evmRpc","cpid":"ethereum","l":"error","t":"watchBlocks error: connection timeout"}
```

## Logged Events

1. **WebSocket connection established** - scope: `socket`, includes pid, sid, IP
2. **Addresses subscribed** - scope: `socket`, includes pid, sid, IP, first 5 chars of addresses, pluginId, checkpoint
3. **Block found** - scope: code plugin, includes `cpid`, block number
4. **Transaction detected** - scope: code plugin, includes `cpid`, first 5 chars of address and txid
5. **Update sent** - scope: `socket`, includes pid, sid, IP, pluginId, address (5 chars), checkpoint

## Notes

- Caller objects cannot contain `d` or `s` keys (will log error)
- All output goes to stdout via `console.log` for logrotate compatibility
