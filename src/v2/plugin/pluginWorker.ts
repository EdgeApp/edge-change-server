// src/v2/plugin/pluginWorker.ts
// Called when cluster.isWorker and PLUGIN_NAME is set

import { Bridge, bridgifyObject } from 'yaob'

import { makeLogger } from '../../util/logger'
import { blockbookPluginFactory } from '../plugins/blockbook/blockbook'
import { evmrpcPluginFactory } from '../plugins/evmRpc/evmRpc'
import { PluginCallbacks, PluginFactory } from '../types/pluginTypes'

// Map of plugin name to factory object (used to look up by PLUGIN_NAME env var)
const pluginFactories: Record<string, PluginFactory> = {
  blockbook: blockbookPluginFactory,
  evmrpc: evmrpcPluginFactory
}

export async function runPluginWorker(): Promise<void> {
  const pluginName = process.env.PLUGIN_NAME
  if (pluginName == null) {
    throw new Error('PLUGIN_NAME env var not set')
  }

  const logger = makeLogger('pluginWorker', pluginName)

  const factory = pluginFactories[pluginName]
  if (factory == null) {
    throw new Error(`Unknown plugin: ${pluginName}`)
  }

  // Verify we're in a forked process with IPC channel
  if (process.send == null) {
    throw new Error(
      'process.send is not available - not running as forked worker'
    )
  }
  const send = process.send.bind(process)

  // Set up yaob bridge over IPC
  const bridge = new Bridge({
    sendMessage(message) {
      send(message)
    }
  })

  process.on('message', message => {
    bridge.handleMessage(message as object)
  })

  // Wait for server to send its callbacks object
  const callbacks = (await bridge.getRoot()) as PluginCallbacks

  // Create the plugin with callbacks
  const plugin = await factory.makePlugin(callbacks)

  // Ignore SIGINT/SIGTERM - we only exit when the primary process stops us via IPC
  // or when the IPC channel disconnects. This prevents race conditions when the
  // terminal sends SIGINT to the entire process group.
  process.on('SIGTERM', () => {
    logger({ t: 'ignoring SIGTERM, waiting for parent to stop us' })
  })
  process.on('SIGINT', () => {
    logger({ t: 'ignoring SIGINT, waiting for parent to stop us' })
  })

  // Handle parent disconnect (IPC channel closed) - this is our fallback
  // if the primary dies without cleanly stopping us
  process.on('disconnect', () => {
    logger({ t: 'parent disconnected, stopping plugin' })
    plugin
      .stop()
      .catch(error => {
        logger.error({ t: 'error stopping plugin', error: String(error) })
      })
      .finally(() => {
        process.exit(0)
      })
  })

  // Send the bridged plugin API to parent
  bridgifyObject(plugin)
  bridge.sendRoot(plugin)
}
