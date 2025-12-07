import readline from 'readline'
import { WebSocket } from 'ws'

import { messageToString } from '../messageToString'
import { serverConfig } from '../serverConfig'
import { changeProtocol, SubscribeParams } from '../types/changeProtocol'

const defaultMetrics = `http://${serverConfig.metricsHost}:${serverConfig.metricsPort}/metrics`
const defaultSocket = `ws://${serverConfig.listenHost}:${serverConfig.listenPort}`

async function main(): Promise<void> {
  // Create the socket:
  const socketUrl = process.argv[2] ?? defaultSocket
  const ws = new WebSocket(socketUrl)

  // Start a terminal:
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  })
  rl.on('SIGINT', () => close())

  function close(): void {
    rl.close()
    ws.close()
  }

  function print(text: string): void {
    console.log(text)
    rl.prompt()
  }

  const codec = changeProtocol.makeClientCodec({
    handleError: error => print(`\nWebSocket sent error: ${String(error)}`),
    handleSend: async text => ws.send(text),
    localMethods: {
      update([pluginId, address, checkpoint = 'no checkpoint']) {
        print(`\nUpdate: ${pluginId} ${address} ${checkpoint}`)
      },
      subLost() {}
    }
  })

  // Handle user input:
  rl.on('line', line => {
    const tokens = line.split(/[ \t]+/)
    switch (tokens[0]) {
      case 'exit': {
        close()
        return
      }

      case 'help': {
        const helps = [
          'exit',
          'help',
          'metrics [<url>]',
          'subscribe <pluginId> <address> [<checkpoint>]',
          'unsubscribe <pluginId> <address>'
        ]
        print(helps.join('\n'))
        return
      }

      case 'metrics': {
        const [, url = defaultMetrics] = tokens
        fetch(url)
          .then(response => {
            if (!response.ok) {
              print(`Fetch ${url} failed with status: ${response.status}`)
              return
            }
            return response.text().then(text => print(text))
          })
          .catch(error => print(`Fetch ${url} failed: ` + String(error)))
        return
      }

      case 'subscribe': {
        const [, pluginId, address, checkpoint] = tokens
        if (pluginId == null || address == null) {
          print('No pluginId or address')
          return
        }
        const params: SubscribeParams = [pluginId, address, checkpoint]
        codec.remoteMethods.subscribe([params]).then(
          value => print('Subscribe result: ' + JSON.stringify(value)),
          error => print('Subscribe failed: ' + String(error))
        )
        return
      }

      case 'unsubscribe': {
        const [, pluginId, address] = tokens
        if (pluginId == null || address == null) {
          print('No pluginId or address')
          return
        }
        const params: SubscribeParams = [pluginId, address]
        codec.remoteMethods.unsubscribe([params]).then(
          () => print('\nUnsubscribed'),
          error => print('\nUnsubscribe failed: ' + String(error))
        )
        return
      }
    }
    print(`No command '${tokens[0]}'`)
    rl.prompt()
  })

  ws.on('open', () => print(`Connected to ${socketUrl}`))

  ws.on('close', () => {
    console.log('Disconnected')
    codec.handleClose()
    close()
  })

  ws.on('message', message => {
    codec.handleMessage(messageToString(message))
  })
}

// Invoke the main function with error reporting:
main().catch(error => {
  console.error(error)
  process.exit(1)
})
