// src/v2/pluginManager.ts

import cluster, { Worker } from 'cluster'
import { Bridge, bridgifyObject } from 'yaob'

import { makeLogger } from '../util/logger'
import { PluginApi, PluginCallbacks, PluginFactory } from './types/pluginTypes'

const logger = makeLogger('pluginManager')

interface PluginInstance {
  factory: PluginFactory
  worker: Worker
  bridge: Bridge
  api: PluginApi
}

export interface PluginManager {
  /** Get the plugin API for a given pluginId */
  getPluginForId: (pluginId: string) => PluginApi | undefined

  /** Get all unique plugins */
  getAllPlugins: () => PluginApi[]

  /** Start all plugins */
  start: () => Promise<void>

  /** Stop all plugins */
  stop: () => Promise<void>
}

export function makePluginManager(
  factories: PluginFactory[],
  callbacks: PluginCallbacks
): PluginManager {
  const plugins: PluginInstance[] = []
  const pluginIdToInstance = new Map<string, PluginInstance>()

  return {
    getPluginForId(pluginId: string): PluginApi | undefined {
      return pluginIdToInstance.get(pluginId)?.api
    },

    getAllPlugins(): PluginApi[] {
      return plugins.map(p => p.api)
    },

    async start(): Promise<void> {
      for (const factory of factories) {
        logger({ t: 'spawning plugin', name: factory.name })
        const instance = await spawnPlugin(factory, callbacks)
        plugins.push(instance)

        // Map pluginIds to this plugin instance
        for (const pluginId of factory.chainPluginIds) {
          pluginIdToInstance.set(pluginId, instance)
        }

        logger({
          t: 'plugin started',
          name: factory.name,
          pluginIds: factory.chainPluginIds
        })
      }
    },

    async stop(): Promise<void> {
      await Promise.all(
        plugins.map(async plugin => {
          logger({ t: 'stopping plugin', name: plugin.factory.name })
          try {
            await plugin.api.stop()
          } catch (error) {
            logger.error({
              t: 'error stopping plugin',
              name: plugin.factory.name,
              error: String(error)
            })
          }
          plugin.worker.kill()
        })
      )
      plugins.length = 0
      pluginIdToInstance.clear()
    }
  }
}

async function spawnPlugin(
  factory: PluginFactory,
  callbacks: PluginCallbacks
): Promise<PluginInstance> {
  return await new Promise((resolve, reject) => {
    // Fork with PLUGIN_NAME env var to tell worker which plugin to run
    const worker = cluster.fork({ PLUGIN_NAME: factory.name })

    const bridge = new Bridge({
      sendMessage(message) {
        worker.send(message)
      }
    })

    worker.on('message', message => {
      bridge.handleMessage(message as object)
    })

    // Send the callbacks object to the worker
    bridgifyObject(callbacks)
    bridge.sendRoot(callbacks)

    // Wait for plugin to send its API
    bridge
      .getRoot()
      .then((api: any) => {
        resolve({
          factory,
          worker,
          bridge,
          api: api as PluginApi
        })
      })
      .catch(reject)

    worker.on('error', reject)
    worker.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `Plugin ${factory.name} exited with code ${code}, signal ${signal}`
          )
        )
      }
    })
  })
}
