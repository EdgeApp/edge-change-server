import { EtherscanV1ScanAdapterConfig } from './EtherscanV1ScanAdapter'
import { EtherscanV2ScanAdapterConfig } from './EtherscanV2ScanAdapter'
import { TatumScanAdapterConfig } from './TatumScanAdapter'

export type ScanAdapterConfig =
  | EtherscanV1ScanAdapterConfig
  | EtherscanV2ScanAdapterConfig
  | TatumScanAdapterConfig

export type ScanAdapter = (
  address: string,
  checkpoint?: string
) => Promise<boolean>
