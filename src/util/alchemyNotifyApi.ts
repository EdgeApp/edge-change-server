import fetch from 'node-fetch'

import { serverConfig } from '../serverConfig'
import { Logger } from './logger'

// Alchemy network identifiers
export type AlchemyNetwork =
  | 'ETH_MAINNET'
  | 'ETH_SEPOLIA'
  | 'ETH_HOLESKY'
  | 'MATIC_MAINNET'
  | 'MATIC_AMOY'
  | 'ARB_MAINNET'
  | 'ARB_SEPOLIA'
  | 'OPT_MAINNET'
  | 'OPT_SEPOLIA'
  | 'BASE_MAINNET'
  | 'BASE_SEPOLIA'

const ALCHEMY_API_BASE = 'https://dashboard.alchemy.com/api'

interface CreateWebhookParams {
  network: AlchemyNetwork
  webhookUrl: string
  addresses?: string[]
}

interface CreateWebhookResponse {
  data: {
    id: string
    network: string
    webhook_type: string
    webhook_url: string
    is_active: boolean
    time_created: number
    signing_key: string
    version: string
    app_id?: string
  }
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

interface GetWebhookAddressesResponse {
  data: string[]
  pagination: {
    cursors: {
      after?: string
    }
    total_count: number
  }
}

export interface WebhookInfo {
  id: string
  network: string
  webhook_type: string
  webhook_url: string
  is_active: boolean
  time_created: number
  signing_key: string
  version: string
  app_id?: string
}

interface GetTeamWebhooksResponse {
  data: WebhookInfo[]
}

export interface AlchemyNotifyApi {
  createWebhook: (params: CreateWebhookParams) => Promise<CreateWebhookResponse>
  updateWebhookAddresses: (
    params: UpdateWebhookAddressesParams
  ) => Promise<void>
  getWebhookAddresses: (
    params: GetWebhookAddressesParams
  ) => Promise<GetWebhookAddressesResponse>
  getTeamWebhooks: () => Promise<WebhookInfo[]>
  deleteWebhook: (webhookId: string) => Promise<void>
}

export function makeAlchemyNotifyApi(logger: Logger): AlchemyNotifyApi {
  function getAuthToken(): string {
    const authToken = serverConfig.alchemyAuthToken
    if (authToken === '') {
      throw new Error('Missing alchemyAuthToken in config')
    }
    return authToken
  }

  async function apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: object
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

    // Some endpoints return empty body (204)
    if (response.status === 204) {
      return (undefined as unknown) as T
    }

    return (await response.json()) as T
  }

  return {
    async createWebhook(
      params: CreateWebhookParams
    ): Promise<CreateWebhookResponse> {
      return await apiRequest<CreateWebhookResponse>(
        '/create-webhook',
        'POST',
        {
          network: params.network,
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: params.webhookUrl,
          addresses: params.addresses ?? []
        }
      )
    },

    async updateWebhookAddresses(
      params: UpdateWebhookAddressesParams
    ): Promise<void> {
      await apiRequest('/update-webhook-addresses', 'PATCH', {
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

      return await apiRequest<GetWebhookAddressesResponse>(
        `/webhook-addresses?${queryParams.toString()}`,
        'GET'
      )
    },

    async getTeamWebhooks(): Promise<WebhookInfo[]> {
      const response = await apiRequest<GetTeamWebhooksResponse>(
        '/team-webhooks',
        'GET'
      )
      return response.data
    },

    async deleteWebhook(webhookId: string): Promise<void> {
      await apiRequest('/delete-webhook', 'DELETE', {
        webhook_id: webhookId
      })
    }
  }
}
