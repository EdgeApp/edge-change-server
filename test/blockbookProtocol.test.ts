import { describe, expect, jest, test } from '@jest/globals'
import waitForExpect from 'wait-for-expect'

import { blockbookProtocol } from '../src/types/blockbookProtocol'

describe('blockbookProtocol server', function () {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const before = () => {
    const serverErrorHandler = jest.fn(() => {})
    const serverSendHandler = jest.fn(async (message: string) => {})
    const server = blockbookProtocol.makeServerCodec({
      handleError: serverErrorHandler,
      handleSend: serverSendHandler,
      localMethods: {
        async subscribeAddresses(params) {
          const { addresses } = params
          if (addresses.length > 0) {
            return { subscribed: true }
          } else return { subscribed: false }
        },
        getAccountInfo: function (_params) {
          throw new Error('Function not implemented.')
        },
        unsubscribeAddresses: function (_params) {
          throw new Error('Function not implemented.')
        },
        async ping() {
          return {}
        },
        async subscribeNewBlock() {
          return { subscribed: true }
        }
      }
    })
    return { server, serverErrorHandler, serverSendHandler }
  }

  test('request/response success', async function () {
    const { server, serverErrorHandler, serverSendHandler } = before()
    server.handleMessage(
      JSON.stringify({
        id: '0',
        method: 'subscribeAddresses',
        params: {
          addresses: ['0x1234']
        }
      })
    )
    await waitForExpect(() => {
      expect(serverErrorHandler).not.toBeCalled()
      expect(serverSendHandler).toBeCalledWith(
        JSON.stringify({ id: '0', data: { subscribed: true } })
      )
    })
  })

  test('request/response failure', async function () {
    const { server, serverErrorHandler, serverSendHandler } = before()
    server.handleMessage(
      JSON.stringify({
        id: '0',
        method: 'subscribeAddresses',
        params: {
          addresses: []
        }
      })
    )
    await waitForExpect(() => {
      expect(serverErrorHandler).not.toBeCalled()
      expect(serverSendHandler).toBeCalledWith(
        JSON.stringify({ id: '0', data: { subscribed: false } })
      )
    })
  })
})

describe('blockbookProtocol client', function () {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const before = () => {
    const clientErrorHandler = jest.fn()
    const clientSubscribeAddressesHandler = jest.fn(() => {})
    const client = blockbookProtocol.makeClientCodec({
      handleError: clientErrorHandler,
      async handleSend(message) {
        server.handleMessage(message)
      },
      localMethods: {
        subscribeAddresses: clientSubscribeAddressesHandler,
        subscribeNewBlock: jest.fn(async () => ({ height: 100, hash: '0000' }))
      }
    })

    const serverErrorHandler = jest.fn()
    const server = blockbookProtocol.makeServerCodec({
      handleError: serverErrorHandler,
      async handleSend(message) {
        client.handleMessage(message)
      },
      localMethods: {
        async subscribeAddresses(params) {
          const { addresses } = params
          if (addresses.length > 0) {
            if (addresses[0] === 'crash') {
              throw new Error('crash')
            }
            return { subscribed: true }
          } else return { subscribed: false }
        },
        getAccountInfo: function (_params) {
          throw new Error('Function not implemented.')
        },
        unsubscribeAddresses: function (_params) {
          throw new Error('Function not implemented.')
        },
        async ping() {
          return {}
        },
        async subscribeNewBlock() {
          return { subscribed: true }
        }
      }
    })

    async function sendUpdate(address: string): Promise<void> {
      const tx = {
        txid: '1234',
        hex: '5678',
        blockHeight: 100,
        confirmations: 1,
        blockTime: Date.now(),
        fees: '1000'
      }
      await server.remoteMethods.subscribeAddresses({ address, tx })
    }

    return {
      client,
      clientErrorHandler,
      clientSubscribeAddressesHandler,
      sendUpdate,
      server,
      serverErrorHandler
    }
  }

  test('request/response success', async function () {
    const { client, clientErrorHandler, serverErrorHandler } = before()
    const address = 'abc'
    const response = await client.remoteMethods.subscribeAddresses({
      addresses: [address]
    })
    expect(response).toEqual({ subscribed: true })
    expect(serverErrorHandler).not.toBeCalled()
    expect(clientErrorHandler).not.toBeCalled()
  })
  test('request/response failure', async function () {
    const { client, clientErrorHandler, serverErrorHandler } = before()
    const response = await client.remoteMethods.subscribeAddresses({
      addresses: []
    })
    expect(response).toEqual({ subscribed: false })
    expect(serverErrorHandler).not.toBeCalled()
    expect(clientErrorHandler).not.toBeCalled()
  })
  test('request/response throw failure', async function () {
    const { client, clientErrorHandler, serverErrorHandler } = before()
    await expect(
      client.remoteMethods.subscribeAddresses({
        addresses: ['crash']
      })
    ).rejects.toThrowError('crash')
    expect(serverErrorHandler).not.toBeCalled()
    expect(clientErrorHandler).not.toBeCalled()
  })

  test('handle subscription notification', async function () {
    const {
      client,
      clientErrorHandler,
      clientSubscribeAddressesHandler,
      sendUpdate,
      serverErrorHandler
    } = before()
    const address = 'abc'
    await client.remoteMethods.subscribeAddresses({
      addresses: [address]
    })
    await sendUpdate(address)

    await waitForExpect(() => {
      expect(clientSubscribeAddressesHandler).toBeCalledWith({
        address,
        tx: {
          blockHeight: 100,
          blockTime: expect.any(Number),
          confirmations: 1,
          fees: '1000',
          txid: '1234'
        }
      })
      expect(serverErrorHandler).not.toBeCalled()
      expect(clientErrorHandler).not.toBeCalled()
    })
  })
})
