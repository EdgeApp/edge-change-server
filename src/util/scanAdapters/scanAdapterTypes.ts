import { EtherscanV1ScanAdapterConfig } from './EtherscanV1ScanAdapter'

export type ScanAdapterConfig = EtherscanV1ScanAdapterConfig

export type ScanAdapter = (
  address: string,
  checkpoint?: string
) => Promise<boolean>
