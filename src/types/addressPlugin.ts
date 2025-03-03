import { OnEvents } from 'yavent'

export interface PluginEvents {
  connect: undefined
  disconnect: undefined
  error: unknown
  update: { address: string; checkpoint?: string }
}

export interface AddressPlugin {
  pluginId: string

  on: OnEvents<PluginEvents>

  // Manage addresses:
  subscribe: (address: string) => Promise<boolean>
  unsubscribe: (address: string) => Promise<boolean>

  // Not all plugins support scanning:
  scanAddress?: (address: string, checkpoint?: string) => Promise<boolean>

  destroy: () => void
}
