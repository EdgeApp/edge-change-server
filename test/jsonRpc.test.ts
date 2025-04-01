import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { asJSON, asNumber, asObject, asString, uncleaner } from 'cleaners'

import { asJsonRpcCall, asJsonRpcReturn, makeRpcProtocol } from '../src/jsonRpc'

const wasJsonRpcCall = uncleaner(asJSON(asJsonRpcCall))
const wasJsonRpcReturn = uncleaner(asJSON(asJsonRpcReturn))

const testProtocol = makeRpcProtocol({
  clientMethods: {
    notification: {
      asParams: asObject({ message: asString })
    }
  },
  serverMethods: {
    greeting: {
      asParams: asObject({ name: asString }),
      asResult: asObject({ message: asString })
    }
  }
})

describe('jsonRpc client/server codec integration', function () {
  const clientErrorHandler = jest.fn()
  const clientNotificationHandler = jest.fn()
  const client = testProtocol.makeClientCodec({
    handleError: clientErrorHandler,
    handleSend: async message => {
      server.handleMessage(message)
    },
    localMethods: {
      notification: clientNotificationHandler
    }
  })

  const serverErrorHandler = jest.fn()
  const server = testProtocol.makeServerCodec({
    handleError: serverErrorHandler,
    handleSend: async message => {
      client.handleMessage(message)
    },
    localMethods: {
      greeting: async function (params) {
        const { name } = params
        return { message: `Hello ${name}` }
      }
    }
  })

  afterEach(() => {
    clientErrorHandler.mockClear()
    clientNotificationHandler.mockClear()
    serverErrorHandler.mockClear()
  })

  test('request/response', async function () {
    const name = 'Bob'
    const response = await client.remoteMethods.greeting({ name })
    expect(response).toEqual({ message: `Hello ${name}` })
    expect(clientErrorHandler).not.toBeCalled()
    expect(serverErrorHandler).not.toBeCalled()
  })

  test('Calling remote methods', async function () {
    expect(clientNotificationHandler).not.toBeCalled()
    server.remoteMethods.notification({ message: 'abc' })
    expect(clientNotificationHandler).toBeCalledWith({ message: 'abc' })
    expect(clientErrorHandler).not.toBeCalled()
    expect(serverErrorHandler).not.toBeCalled()
  })
})

describe('jsonRpc handleMessage', function () {
  const mockError = jest.fn<(error: unknown) => void>()
  const mockSend = jest.fn<(payload: any) => Promise<void>>()
  const testProtocol = makeRpcProtocol({
    serverMethods: {
      ping: {
        asParams: asObject({ value: asNumber }),
        asResult: asObject({ pong: asNumber })
      },
      notif: {
        asParams: asObject({ value: asNumber })
      }
    },
    clientMethods: {}
  })

  const codec = testProtocol.makeServerCodec({
    handleError: mockError,
    handleSend: async message => {
      return await mockSend(JSON.parse(message))
    },
    localMethods: {
      ping: async params => {
        return { pong: params.value }
      },
      notif: async () => {}
    }
  })

  afterEach(() => {
    mockError.mockClear()
    mockSend.mockClear()
  })

  /**
   * Closes any resources the plugin has open
   * in response to a complete server shutdown.
   */
  test('call: invalid JSON', async function () {
    const bad = 'abd'
    codec.handleMessage(bad)
    expect(mockSend).toBeCalled()
  })

  test('call: missing method', async function () {
    const bogusMethod = 'bogus'
    codec.handleMessage(
      wasJsonRpcCall({
        jsonrpc: '2.0',
        method: bogusMethod,
        params: undefined
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: `Method not found: ${bogusMethod}`
      }
    })
  })

  test('call: missing id', async function () {
    codec.handleMessage(
      wasJsonRpcCall({
        jsonrpc: '2.0',
        method: 'ping',
        params: undefined
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: `Invalid JSON-RPC request: missing id`
      }
    })
  })

  test('call: invalid params', async function () {
    codec.handleMessage(
      wasJsonRpcCall({
        jsonrpc: '2.0',
        id: 123,
        method: 'ping',
        params: { value: '123' }
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32602,
        message: `Invalid params: Expected a number at .value`
      }
    })
  })

  test('call: notification with id', async function () {
    codec.handleMessage(
      wasJsonRpcCall({
        jsonrpc: '2.0',
        id: 123,
        method: 'notif',
        params: { value: 123 }
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: `Invalid JSON-RPC request: notification has an id`
      }
    })
  })

  test('response: invalid id', async function () {
    codec.handleMessage(
      wasJsonRpcReturn({
        jsonrpc: '2.0',
        result: 'foo',
        id: '404'
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: '404',
      error: {
        code: -32603,
        message: `Cannot find id 404`
      }
    })
  })

  test('response: missing request', async function () {
    codec.handleMessage(
      wasJsonRpcReturn({
        jsonrpc: '2.0',
        result: 'foo',
        id: 404
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: 404,
      error: {
        code: -32603,
        message: `Cannot find id 404`
      }
    })
  })

  test('invalid json', async function () {
    codec.handleMessage(
      JSON.stringify({
        result: 'foo',
        id: 404
      })
    )
    expect(mockSend).toBeCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: `Invalid JSON-RPC request / response`
      }
    })
  })
})
