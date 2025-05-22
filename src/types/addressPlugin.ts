import { OnEvents } from 'yavent'

export interface PluginEvents {
  subLost: { addresses: string[] }
  update: { address: string; checkpoint?: string }
}

export interface AddressPlugin {
  pluginId: string

  on: OnEvents<PluginEvents>

  // Manage addresses:
  subscribe: (address: string) => Promise<boolean>
  unsubscribe: (address: string) => Promise<boolean>

  /**
   * Scan an address to determine if it has any updates.
   *
   * This method is optional, because not all plugins support scanning.
   *
   * @param address - The address to scan.
   * @param checkpoint - The checkpoint to scan from.
   * @returns `true` if the address has updates, `false` otherwise.
   */
  scanAddress?: (address: string, checkpoint?: string) => Promise<boolean>
}
