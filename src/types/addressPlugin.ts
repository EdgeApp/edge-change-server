import { OnEvents } from 'yavent'

export interface PluginEvents {
  connect: undefined
  disconnect: undefined
  update: { address: string; checkpoint?: string }
}

export interface AddressPlugin {
  pluginId: string

  on: OnEvents<PluginEvents>

  // Manage addresses:
  subscribe: (address: string) => void
  unsubscribe: (address: string) => void

  // Not all plugins support scanning:
  scanAddress?: (address: string, checkpoint?: string) => Promise<boolean>
}
