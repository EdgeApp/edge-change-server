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
import WebSocket from 'ws'

import { messageToString } from '../../src/messageToString'
import { makeBlockbook } from '../../src/plugins/blockbook'
import { serverConfig } from '../../src/serverConfig'
import { AddressPlugin } from '../../src/types/addressPlugin'
import { blockbookProtocol } from '../../src/types/blockbookProtocol'

// Enable this for debug testing against a real server. It may break some tests.
const USE_REAL_BLOCKBOOK_SERVER = false

describe('blockbook plugin', function () {
  const TEST_ADDRESS = 'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc'
  const LOW_CHECKPOINT = '1'
  const HIGH_CHECKPOINT = '999999999'

  const host = 'localhost'
  const port = Math.floor(Math.random() * 1000 + 5000)
  const mockBlockbookUrl = USE_REAL_BLOCKBOOK_SERVER
    ? `wss://btcbook.nownodes.io/wss/${serverConfig.nowNodesApiKey}`
    : `ws://${host}:${port}`

  const blockbookWsServer = new WebSocket.Server({
    host,
    port
  })
  beforeAll(() => {
    blockbookWsServer.on('connection', socket => {
      const codec = blockbookProtocol.makeServerCodec({
        handleError(error) {
          console.error(error)
          socket.close()
        },
        async handleSend(text) {
          socket.send(text)
        },
        localMethods: {
          async subscribeAddresses(params) {
            const [address] = params.addresses
            const tx = {
              txid:
                '0eb7b574373de2c88d0dc1444f49947c681d0437d21361f9ebb4dd09c62f2a66',
              hex: '',
              blockHeight: 0,
              confirmations: 0,
              blockTime: Date.now(),
              fees: '0'
            }
            codec.remoteMethods.subscribeAddresses({ address, tx })
            return { subscribed: true }
          },
          async subscribeNewBlock() {
            return { subscribed: true }
          },
          getAccountInfo: async function (params) {
            if (params.from == null) {
              return {
                page: 1,
                totalPages: 1,
                itemsOnPage: 25,
                address: 'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc',
                balance: '0',
                totalReceived: '10106300',
                totalSent: '10106300',
                unconfirmedBalance: '0',
                unconfirmedTxs: 0,
                txs: 2,
                transactions: [
                  {
                    txid:
                      '8c1e3dec662d1f2a5e322ccef5eca263f98eb16723c6f990be0c88c1db113fb1',
                    blockHeight: 123,
                    confirmations: 1
                  },
                  {
                    txid:
                      '0eb7b574373de2c88d0dc1444f49947c681d0437d21361f9ebb4dd09c62f2a66',
                    blockHeight: 123,
                    confirmations: 1
                  }
                ],
                txids: []
              }
            }
            if (params.from === Number(LOW_CHECKPOINT)) {
              return {
                page: 1,
                totalPages: 1,
                itemsOnPage: 25,
                address: 'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc',
                balance: '0',
                totalReceived: '10106300',
                totalSent: '10106300',
                unconfirmedBalance: '0',
                unconfirmedTxs: 0,
                txs: 2,
                transactions: [
                  {
                    txid:
                      '8c1e3dec662d1f2a5e322ccef5eca263f98eb16723c6f990be0c88c1db113fb1',
                    blockHeight: 123,
                    confirmations: 1
                  },
                  {
                    txid:
                      '0eb7b574373de2c88d0dc1444f49947c681d0437d21361f9ebb4dd09c62f2a66',
                    blockHeight: 123,
                    confirmations: 1
                  }
                ],
                txids: []
              }
            }
            if (params.from === Number(HIGH_CHECKPOINT)) {
              return {
                page: 1,
                totalPages: 1,
                itemsOnPage: 25,
                address: 'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc',
                balance: '0',
                totalReceived: '10106300',
                totalSent: '10106300',
                unconfirmedBalance: '0',
                unconfirmedTxs: 0,
                txs: 2,
                transactions: undefined,
                txids: []
              }
            }

            throw new Error('Function not implemented.')
          },
          unsubscribeAddresses: function (_params) {
            throw new Error('Function not implemented.')
          },
          ping: async function () {
            return {}
          }
        }
      })

      socket.on('error', error => {
        console.error(`connection error: ${String(error)}`)
      })

      socket.on('message', message => {
        const messageString = messageToString(message)
        codec.handleMessage(messageString)
      })
    })
  })

  afterAll(() => {
    blockbookWsServer.close()
  })

  const consoleWarnSpy = jest.spyOn(console, 'warn')
  let plugin: AddressPlugin
  beforeEach(() => {
    plugin = makeBlockbook({
      pluginId: 'test',
      url: mockBlockbookUrl
    })
  })
  afterEach(() => {
    consoleWarnSpy.mockClear()
  })

  test('plugin instantiation and connection', async function () {
    const disconnectHandler = jest.fn()
    expect(plugin.pluginId).toBe('test')
    plugin.on('subLost', disconnectHandler)
    await plugin.subscribe(TEST_ADDRESS)
    expect(disconnectHandler).not.toBeCalled()
  })

  test('subscribe should return true', async function () {
    const result = await plugin.subscribe(TEST_ADDRESS)
    expect(result).toBe(true)
  })

  test('subscription update should be received', function (done) {
    const disconnectHandler = jest.fn()
    plugin.on('subLost', disconnectHandler)
    plugin.on('update', data => {
      expect(disconnectHandler).not.toBeCalled()
      expect(consoleWarnSpy).not.toBeCalled()
      expect(data.address).toBe(TEST_ADDRESS)
      done()
    })
    plugin.subscribe(TEST_ADDRESS).catch(err => {
      done(err)
    })
  })

  test('scanAddress behavior', async function () {
    if (plugin.scanAddress == null) {
      throw new Error('missing scanAddress')
    }
    await plugin.subscribe(TEST_ADDRESS)
    const resultNoCheckpoint = await plugin.scanAddress(TEST_ADDRESS)
    expect(resultNoCheckpoint).toBe(true)
    const resultLowCheckpoint = await plugin.scanAddress(
      TEST_ADDRESS,
      LOW_CHECKPOINT
    )
    expect(resultLowCheckpoint).toBe(true)
    const resultHighCheckpoint = await plugin.scanAddress(
      TEST_ADDRESS,
      HIGH_CHECKPOINT
    )
    expect(resultHighCheckpoint).toBe(false)
    expect(consoleWarnSpy).not.toBeCalled()
  })
})
