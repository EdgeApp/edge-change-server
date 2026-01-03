/**
 * Test that directly triggers a fake update through the system.
 * This helps debug the update propagation path.
 *
 * Run with: node -r sucrase/register test/v2/fakeUpdateTest.ts
 */

import WebSocket from 'ws'

import { messageToString } from '../../src/messageToString'
import { changeProtocol } from '../../src/types/changeProtocol'

const TEST_ADDRESS = '0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9'

const ws = new WebSocket('ws://127.0.0.1:8008')

let updateReceived = false

const codec = changeProtocol.makeClientCodec({
  handleError(error) {
    console.error('Codec error:', error)
  },
  async handleSend(text) {
    ws.send(text)
  },
  localMethods: {
    update(params) {
      console.log('🎉 UPDATE RECEIVED:', {
        pluginId: params[0],
        address: params[1],
        checkpoint: params[2]
      })
      updateReceived = true
    },
    subLost(params) {
      console.log('❌ SUBLOST:', params)
    }
  }
})

ws.on('open', () => {
  console.log('Connected to server')

  // Subscribe to ethereum (we'll fake an update for this)
  console.log(`Subscribing to ethereum for ${TEST_ADDRESS}...`)
  codec.remoteMethods
    .subscribe([['ethereum', TEST_ADDRESS]])
    .then(results => {
      console.log('Subscribe result:', results[0])
      console.log('')
      console.log(
        'Now send a fake update by POSTing to /debug/update endpoint or'
      )
      console.log('manually triggering from the server.')
      console.log('')
      console.log('Waiting 10 seconds for update...')

      // Wait 10 seconds then check
      setTimeout(() => {
        if (!updateReceived) {
          console.log('❌ No update received after 10 seconds')
          console.log('')
          console.log('Debug: Check server logs for:')
          console.log('  - "DEBUG: triggering fake update" (chain worker)')
          console.log('  - "update" (sent to client)')
        }
        ws.close()
        process.exit(updateReceived ? 0 : 1)
      }, 10000)
    })
    .catch(error => {
      console.error('Subscribe error:', error)
      ws.close()
      process.exit(1)
    })
})

ws.on('message', message => {
  codec.handleMessage(messageToString(message))
})

ws.on('error', error => {
  console.error('WebSocket error:', error)
})

ws.on('close', () => {
  console.log('Connection closed')
})
