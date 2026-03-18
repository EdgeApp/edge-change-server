import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import { EventEmitter } from 'events'

import { makeCosmosWs } from '../../src/plugins/cosmosWs'

// Shared instances array, populated by the mock constructor
let mockWsInstances: MockWebSocket[] = []

interface MockWebSocket extends EventEmitter {
  url: string
  readyState: number
  sent: string[]
  close: () => void
  send: (data: string) => void
}

jest.mock('ws', () => {
  const { EventEmitter: EE } = jest.requireActual<typeof import('events')>(
    'events'
  )

  class MockWebSocketImpl extends EE {
    public readyState: number = 1
    public sent: string[] = []

    constructor(public url: string) {
      super()
      // Push to the shared instances array (accessed via closure trick below)
      ;(MockWebSocketImpl as any).__instances.push(this)
    }

    send(data: string): void {
      this.sent.push(data)
    }

    close(): void {
      this.readyState = 3
    }

    removeAllListeners(): this {
      return super.removeAllListeners()
    }
  }

  ;(MockWebSocketImpl as any).__instances = []

  return MockWebSocketImpl
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WsMock: any = jest.requireMock('ws')

function resetInstances(): void {
  WsMock.__instances = []
  mockWsInstances = WsMock.__instances as MockWebSocket[]
}

function getLastWs(): MockWebSocket {
  return mockWsInstances[mockWsInstances.length - 1]
}

function makeTxEvent(eventData: Record<string, string[]>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      query: "tm.event='Tx'",
      data: { type: 'tendermint/event/Tx', value: {} },
      events: eventData
    }
  })
}

describe('makeCosmosWs', () => {
  beforeEach(() => {
    resetInstances()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('subscribes to Tx events on connect', () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    expect(ws.sent).toHaveLength(1)
    const msg = JSON.parse(ws.sent[0])
    expect(msg.method).toBe('subscribe')
    expect(msg.params.query).toBe("tm.event='Tx'")

    plugin.destroy?.()
  })

  it('subscribe/unsubscribe manages addresses', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })

    const r1 = await plugin.subscribe('cosmos1abc')
    expect(r1).toBe(true)

    const r2 = await plugin.unsubscribe('cosmos1abc')
    expect(r2).toBe(true)

    const r3 = await plugin.unsubscribe('cosmos1abc')
    expect(r3).toBe(false)

    plugin.destroy?.()
  })

  it('emits update for matching transfer.sender', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1sender123')

    const updates: string[] = []
    plugin.on('update', ({ address }) => updates.push(address))

    ws.emit('message', makeTxEvent({ 'transfer.sender': ['cosmos1sender123'] }))
    expect(updates).toEqual(['cosmos1sender123'])

    plugin.destroy?.()
  })

  it('emits update for matching transfer.recipient', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1recipient456')

    const updates: string[] = []
    plugin.on('update', ({ address }) => updates.push(address))

    ws.emit(
      'message',
      makeTxEvent({ 'transfer.recipient': ['cosmos1recipient456'] })
    )
    expect(updates).toEqual(['cosmos1recipient456'])

    plugin.destroy?.()
  })

  it('emits update for matching coin_spent.spender', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1spender789')

    const updates: string[] = []
    plugin.on('update', ({ address }) => updates.push(address))

    ws.emit(
      'message',
      makeTxEvent({ 'coin_spent.spender': ['cosmos1spender789'] })
    )
    expect(updates).toEqual(['cosmos1spender789'])

    plugin.destroy?.()
  })

  it('does not emit update for non-subscribed addresses', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1subscribed')

    const updates: string[] = []
    plugin.on('update', ({ address }) => updates.push(address))

    ws.emit('message', makeTxEvent({ 'transfer.sender': ['cosmos1other'] }))
    expect(updates).toHaveLength(0)

    plugin.destroy?.()
  })

  it('emits subLost on close with subscribed addresses', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1a')
    await plugin.subscribe('cosmos1b')

    const subLostEvents: string[][] = []
    plugin.on('subLost', ({ addresses }) => subLostEvents.push(addresses))

    ws.emit('close')

    expect(subLostEvents).toHaveLength(1)
    expect(subLostEvents[0]).toContain('cosmos1a')
    expect(subLostEvents[0]).toContain('cosmos1b')

    plugin.destroy?.()
  })

  it('reconnects with exponential backoff after disconnect', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws1 = getLastWs()
    ws1.emit('open')
    ws1.emit('close')

    // First reconnect after 1000ms
    expect(mockWsInstances).toHaveLength(1)
    jest.advanceTimersByTime(1000)
    expect(mockWsInstances).toHaveLength(2)

    const ws2 = getLastWs()
    ws2.emit('open')
    ws2.emit('close')

    // Second reconnect after 2000ms
    jest.advanceTimersByTime(2000)
    expect(mockWsInstances).toHaveLength(3)

    plugin.destroy?.()
  })

  it('does not reconnect after destroy', () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')
    plugin.destroy?.()

    jest.advanceTimersByTime(60000)
    expect(mockWsInstances).toHaveLength(1)
  })

  it('ignores messages with no matching event attributes', async () => {
    const plugin = makeCosmosWs({
      pluginId: 'test',
      wsUrl: 'wss://test.example.com/websocket'
    })
    const ws = getLastWs()
    ws.emit('open')

    await plugin.subscribe('cosmos1test')

    const updates: string[] = []
    plugin.on('update', ({ address }) => updates.push(address))

    ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
    expect(updates).toHaveLength(0)

    plugin.destroy?.()
  })
})
