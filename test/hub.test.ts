import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from '@jest/globals'
import waitForExpect from 'wait-for-expect'
import WebSocket from 'ws'
import { makeEvents } from 'yavent'

import { makeAddressHub } from '../src/hub'
import { messageToString } from '../src/messageToString'
import { AddressPlugin, PluginEvents } from '../src/types/addressPlugin'
import { changeProtocol } from '../src/types/changeProtocol'
import { snooze } from './util/snooze'

describe('AddressHub', function () {
  const SCANNABLE_PLUGIN_ID = 'scannable'
  const UNSCANNABLE_PLUGIN_ID = 'unscannable'
  const TEST_ADDRESS = 'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc'
  const HIGH_CHECKPOINT = '999999999'

  const host = 'localhost'
  const port = 7357
  const serverUrl = `ws://${host}:${port}`

  const [pluginEvents, pluginEmitter] = makeEvents<PluginEvents>()

  function makeFakePlugin(
    pluginId: string,
    canScanAddress: boolean
  ): AddressPlugin {
    setTimeout(() => {
      pluginEmitter('connect', undefined)
    }, 100)
    return {
      pluginId,
      on: pluginEvents,
      async subscribe(address) {
        setTimeout(() => {
          pluginEmitter('update', { address })
        }, 100)
        return true
      },
      async unsubscribe() {
        return true
      },
      scanAddress: canScanAddress
        ? async (_address, checkpoint): Promise<boolean> => {
            if (checkpoint === HIGH_CHECKPOINT) {
              return false
            }
            return true
          }
        : undefined
    }
  }

  let serverWs: WebSocket.Server
  beforeAll(() => {
    const scannablePlugin = makeFakePlugin(SCANNABLE_PLUGIN_ID, true)
    const unscannablePlugin = makeFakePlugin(UNSCANNABLE_PLUGIN_ID, false)
    const hub = makeAddressHub({
      plugins: [scannablePlugin, unscannablePlugin]
    })
    serverWs = new WebSocket.Server({
      host,
      port
    })
    serverWs.on('connection', ws => {
      hub.handleConnection(ws)
    })
  })
  afterAll(() => {
    serverWs.close()
  })

  let clientWs: WebSocket
  let changeClient: ReturnType<typeof changeProtocol.makeClientCodec>
  const handleError = jest.fn()
  const update = jest.fn()
  const pluginDisconnect = jest.fn()
  const ready = jest.fn()
  beforeEach(() => {
    clientWs = new WebSocket(serverUrl)
    changeClient = changeProtocol.makeClientCodec({
      handleError,
      handleSend: async text => {
        clientWs.send(text)
      },
      localMethods: {
        update,
        pluginDisconnect
      }
    })
    clientWs.on('open', ready)
    clientWs.on('message', message => {
      const payload = messageToString(message)
      changeClient.handleMessage(payload)
    })
  })
  afterEach(() => {
    handleError.mockClear()
    update.mockClear()
    pluginDisconnect.mockClear()
    ready.mockClear()
    clientWs.close()
  })

  test('subscribe scannable plugin', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    const result = await changeClient.remoteMethods.subscribe([
      [SCANNABLE_PLUGIN_ID, TEST_ADDRESS]
    ])
    expect(result).toEqual([2])
  })
  test('subscribe scannable plugin with checkpoint', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    const result = await changeClient.remoteMethods.subscribe([
      [SCANNABLE_PLUGIN_ID, TEST_ADDRESS, HIGH_CHECKPOINT]
    ])
    expect(result).toEqual([1])
  })
  test('subscribe unscannable plugin', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    const result = await changeClient.remoteMethods.subscribe([
      [UNSCANNABLE_PLUGIN_ID, TEST_ADDRESS]
    ])
    expect(result).toEqual([0])
  })
  test('subscribe unscannable plugin with checkpoint', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    const result = await changeClient.remoteMethods.subscribe([
      [UNSCANNABLE_PLUGIN_ID, TEST_ADDRESS, HIGH_CHECKPOINT]
    ])
    expect(result).toEqual([0])
  })

  test('subscription life-cycle', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    await changeClient.remoteMethods.subscribe([
      [SCANNABLE_PLUGIN_ID, TEST_ADDRESS]
    ])
    await waitForExpect(() => {
      expect(update).toBeCalledWith([
        SCANNABLE_PLUGIN_ID,
        TEST_ADDRESS,
        undefined
      ])
    })
    await changeClient.remoteMethods.unsubscribe([
      [SCANNABLE_PLUGIN_ID, TEST_ADDRESS]
    ])
    update.mockClear()
    await snooze(200)
    await waitForExpect(() => {
      expect(update).not.toBeCalled()
    })
  })

  test('plugin disconnect should trigger pluginDisconnect method', async function () {
    await waitForExpect(() => {
      expect(ready).toBeCalled()
    })
    await changeClient.remoteMethods.subscribe([
      [SCANNABLE_PLUGIN_ID, TEST_ADDRESS]
    ])
    pluginEmitter('disconnect', undefined)
    await waitForExpect(() => {
      expect(pluginDisconnect).toBeCalledWith({
        pluginId: SCANNABLE_PLUGIN_ID
      })
    })
  })
})
