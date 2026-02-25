import {
  asArray,
  asBoolean,
  asJSON,
  asNumber,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'
import fetch from 'node-fetch'

import { serverConfig } from '../serverConfig'
import { makeLogger } from './logger'

export interface AlchemyNotifyApi {
  createWebhook: (params: CreateWebhookParams) => Promise<CreateWebhookResponse>
  updateWebhook: (params: UpdateWebhookParams) => Promise<void>
  updateWebhookAddresses: (
    params: UpdateWebhookAddressesParams
  ) => Promise<void>
  getWebhookAddresses: (
    params: GetWebhookAddressesParams
  ) => Promise<GetWebhookAddressesResponse>
  getTeamWebhooks: () => Promise<WebhookInfo[]>
  deleteWebhook: (webhookId: string) => Promise<void>
}

interface CreateWebhookParams {
  network: AlchemyNetwork
  webhookUrl: string
  addresses?: string[]
}

interface UpdateWebhookAddressesParams {
  webhookId: string
  addressesToAdd?: string[]
  addressesToRemove?: string[]
}

interface GetWebhookAddressesParams {
  webhookId: string
  limit?: number
  after?: string
}

interface UpdateWebhookParams {
  webhookId: string
  webhookUrl?: string
  isActive?: boolean
}

// Alchemy network identifiers
// https://docs.alchemy.com/reference/create-webhook
export type AlchemyNetwork =
  // Ethereum
  | 'ETH_MAINNET'
  | 'ETH_SEPOLIA'
  | 'ETH_HOLESKY'
  | 'ETH_HOODI'
  // Polygon
  | 'MATIC_MAINNET'
  | 'MATIC_AMOY'
  // Polygon zkEVM
  | 'POLYGONZKEVM_MAINNET'
  | 'POLYGONZKEVM_CARDONA'
  // Optimism
  | 'OPT_MAINNET'
  | 'OPT_SEPOLIA'
  // Arbitrum
  | 'ARB_MAINNET'
  | 'ARB_SEPOLIA'
  // Arbitrum Nova
  | 'ARBNOVA_MAINNET'
  // Astar
  | 'ASTAR_MAINNET'
  // Base
  | 'BASE_MAINNET'
  | 'BASE_SEPOLIA'
  // zkSync
  | 'ZKSYNC_MAINNET'
  | 'ZKSYNC_SEPOLIA'
  // Shape
  | 'SHAPE_MAINNET'
  | 'SHAPE_SEPOLIA'
  // Linea
  | 'LINEA_MAINNET'
  | 'LINEA_SEPOLIA'
  // Fantom
  | 'FANTOM_MAINNET'
  | 'FANTOM_TESTNET'
  // ZetaChain
  | 'ZETACHAIN_MAINNET'
  | 'ZETACHAIN_TESTNET'
  // Blast
  | 'BLAST_MAINNET'
  | 'BLAST_SEPOLIA'
  // Mantle
  | 'MANTLE_MAINNET'
  | 'MANTLE_SEPOLIA'
  // Scroll
  | 'SCROLL_MAINNET'
  | 'SCROLL_SEPOLIA'
  // Gnosis
  | 'GNOSIS_MAINNET'
  | 'GNOSIS_CHIADO'
  // BNB
  | 'BNB_MAINNET'
  | 'BNB_TESTNET'
  // Avalanche
  | 'AVAX_MAINNET'
  | 'AVAX_FUJI'
  // Celo
  | 'CELO_MAINNET'
  | 'CELO_ALFAJORES'
  | 'CELO_BAKLAVA'
  // Metis
  | 'METIS_MAINNET'
  // opBNB
  | 'OPBNB_MAINNET'
  | 'OPBNB_TESTNET'
  // Berachain
  | 'BERACHAIN_MAINNET'
  | 'BERACHAIN_BEPOLIA'
  // Soneium
  | 'SONEIUM_MAINNET'
  | 'SONEIUM_MINATO'
  // WorldChain
  | 'WORLDCHAIN_MAINNET'
  | 'WORLDCHAIN_SEPOLIA'
  // Rootstock
  | 'ROOTSTOCK_MAINNET'
  | 'ROOTSTOCK_TESTNET'
  // Flow
  | 'FLOW_MAINNET'
  | 'FLOW_TESTNET'
  // Zora
  | 'ZORA_MAINNET'
  | 'ZORA_SEPOLIA'
  // Frax
  | 'FRAX_MAINNET'
  | 'FRAX_SEPOLIA'
  // Polynomial
  | 'POLYNOMIAL_MAINNET'
  | 'POLYNOMIAL_SEPOLIA'
  // CrossFi
  | 'CROSSFI_MAINNET'
  | 'CROSSFI_TESTNET'
  // ApeChain
  | 'APECHAIN_MAINNET'
  | 'APECHAIN_CURTIS'
  // Lens
  | 'LENS_MAINNET'
  | 'LENS_SEPOLIA'
  // Geist
  | 'GEIST_MAINNET'
  | 'GEIST_POLTER'
  // Lumia
  | 'LUMIA_PRISM'
  | 'LUMIA_TESTNET'
  // Unichain
  | 'UNICHAIN_MAINNET'
  | 'UNICHAIN_SEPOLIA'
  // Sonic
  | 'SONIC_MAINNET'
  | 'SONIC_BLAZE'
  // Abstract
  | 'ABSTRACT_MAINNET'
  | 'ABSTRACT_TESTNET'
  // Degen
  | 'DEGEN_MAINNET'
  // Ink
  | 'INK_MAINNET'
  | 'INK_SEPOLIA'
  // Sei
  | 'SEI_MAINNET'
  | 'SEI_TESTNET'
  // Ronin
  | 'RONIN_MAINNET'
  | 'RONIN_SAIGON'
  // Solana
  | 'SOLANA_MAINNET'
  | 'SOLANA_DEVNET'
  // Settlus
  | 'SETTLUS_MAINNET'
  | 'SETTLUS_SEPTESTNET'
  // SuperSeed
  | 'SUPERSEED_MAINNET'
  | 'SUPERSEED_SEPOLIA'
  // Anime
  | 'ANIME_MAINNET'
  | 'ANIME_SEPOLIA'
  // Story
  | 'STORY_MAINNET'
  | 'STORY_AENEID'
  // Testnet-only
  | 'XMTP_TESTNET'
  | 'MONAD_TESTNET'
  | 'GENSYN_TESTNET'
  | 'TEA_SEPOLIA'
  | 'MEGAETH_TESTNET'

const ALCHEMY_API_BASE = 'https://dashboard.alchemy.com/api'

export function makeAlchemyNotifyApi(): AlchemyNotifyApi {
  const logger = makeLogger('alchemy-notify-api')

  function getAuthToken(): string {
    const authToken = serverConfig.alchemyAuthToken
    if (authToken === '') {
      throw new Error('Missing alchemyAuthToken in config')
    }
    return authToken
  }

  async function apiRequestVoid(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: object
  ): Promise<void> {
    await apiRequest(endpoint, method, body)
  }

  async function apiRequest<T = undefined>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: object,
    asResponse?: Cleaner<T>
  ): Promise<T> {
    const authToken = getAuthToken()
    const url = `${ALCHEMY_API_BASE}${endpoint}`

    logger.info({ method, endpoint, msg: 'Alchemy API request' })

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': authToken
      },
      body: body != null ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Alchemy API error: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    if (asResponse == null) {
      return undefined as T
    }

    const text = await response.text()
    try {
      return asResponse(text)
    } catch (err: unknown) {
      logger.error({
        err,
        responseText: text,
        msg: 'Alchemy API cleaner error'
      })
      throw err
    }
  }

  return {
    async createWebhook(
      params: CreateWebhookParams
    ): Promise<CreateWebhookResponse> {
      return await apiRequest(
        '/create-webhook',
        'POST',
        {
          network: params.network,
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: params.webhookUrl,
          addresses: params.addresses ?? []
        },
        asCreateWebhookResponse
      )
    },

    async updateWebhook(params: UpdateWebhookParams): Promise<void> {
      const body: Record<string, unknown> = {
        webhook_id: params.webhookId
      }
      if (params.webhookUrl != null) {
        body.webhook_url = params.webhookUrl
      }
      if (params.isActive != null) {
        body.is_active = params.isActive
      }
      await apiRequestVoid('/update-webhook', 'PUT', body)
    },

    async updateWebhookAddresses(
      params: UpdateWebhookAddressesParams
    ): Promise<void> {
      await apiRequestVoid('/update-webhook-addresses', 'PATCH', {
        webhook_id: params.webhookId,
        addresses_to_add: params.addressesToAdd ?? [],
        addresses_to_remove: params.addressesToRemove ?? []
      })
    },

    async getWebhookAddresses(
      params: GetWebhookAddressesParams
    ): Promise<GetWebhookAddressesResponse> {
      const queryParams = new URLSearchParams({
        webhook_id: params.webhookId
      })
      if (params.limit != null) {
        queryParams.set('limit', params.limit.toString())
      }
      if (params.after != null) {
        queryParams.set('after', params.after)
      }

      return await apiRequest(
        `/webhook-addresses?${queryParams.toString()}`,
        'GET',
        undefined,
        asGetWebhookAddressesResponse
      )
    },

    async getTeamWebhooks(): Promise<WebhookInfo[]> {
      const response = await apiRequest(
        '/team-webhooks',
        'GET',
        undefined,
        asGetTeamWebhooksResponse
      )
      return response.data
    },

    async deleteWebhook(webhookId: string): Promise<void> {
      await apiRequestVoid(`/delete-webhook?webhook_id=${webhookId}`, 'DELETE')
    }
  }
}

//
// Cleaners & Types
//

const asWebhookInfo = asObject({
  id: asString,
  network: asString,
  webhook_type: asString,
  webhook_url: asString,
  is_active: asBoolean,
  time_created: asNumber,
  signing_key: asString,
  version: asString,
  app_id: asOptional(asString)
})

export type WebhookInfo = ReturnType<typeof asWebhookInfo>

const asCreateWebhookResponse = asJSON(
  asObject({
    data: asWebhookInfo
  })
)

type CreateWebhookResponse = ReturnType<typeof asCreateWebhookResponse>

const asGetWebhookAddressesResponse = asJSON(
  asObject({
    data: asArray(asString),
    pagination: asObject({
      cursors: asObject({
        after: asOptional(asString)
      }),
      total_count: asNumber
    })
  })
)

type GetWebhookAddressesResponse = ReturnType<
  typeof asGetWebhookAddressesResponse
>

const asGetTeamWebhooksResponse = asJSON(
  asObject({
    data: asArray(asWebhookInfo)
  })
)
