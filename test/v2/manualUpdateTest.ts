/**
 * Manual test script to verify updates are propagating.
 * Run with: npx ts-node test/v2/manualUpdateTest.ts
 *
 * This will subscribe to polygon (which has frequent blocks)
 * and wait for updates.
 */

import WebSocket from 'ws'

import { messageToString } from '../../src/messageToString'
import { changeProtocol } from '../../src/types/changeProtocol'

// Address that has recent activity on polygon
const TEST_ADDRESS = '0x6504C5D0721BeD8B77dC48b6f2532D8D3D5D55A9'

const ws = new WebSocket('ws://127.0.0.1:8008')

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
    },
    subLost(params) {
      console.log('❌ SUBLOST:', {
        pluginId: params[0],
        address: params[1]
      })
    }
  }
})

ws.on('open', async () => {
  console.log('Connected to server')

  // Subscribe to polygon (frequent blocks) without checkpoint
  // This should get result 2 and then receive updates on tx
  console.log(`Subscribing to polygon for ${TEST_ADDRESS}...`)
  const results = await codec.remoteMethods.subscribe([
    ['polygon', TEST_ADDRESS]
  ])
  console.log('Subscribe result:', results[0])
  console.log('')
  console.log('Waiting for updates (Ctrl+C to stop)...')
  console.log('Watch server logs for "tx detected" events')
})

ws.on('message', message => {
  codec.handleMessage(messageToString(message))
})

ws.on('error', error => {
  console.error('WebSocket error:', error)
})

ws.on('close', () => {
  console.log('Connection closed')
  process.exit(0)
})

// Keep running
process.on('SIGINT', () => {
  console.log('\nUnsubscribing...')
  codec.remoteMethods
    .unsubscribe([['polygon', TEST_ADDRESS]])
    .then(() => {
      ws.close()
    })
    .catch(console.error)
})
