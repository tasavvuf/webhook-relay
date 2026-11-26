import type {
  Endpoint,
  EndpointCreate,
  IngestResult,
  WebhookEventDetail,
  WebhookEventSummary,
} from '../types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export function getBackendOrigin(): string {
  if (API_BASE) {
    return API_BASE
  }
  if (typeof window !== 'undefined') {
    return window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : window.location.origin
  }
  return 'http://localhost:8000'
}

export function getPublicIngestUrl(slug: string): string {
  return `${getBackendOrigin()}/api/ingest/${slug}`
}

export function getDemoSinkUrl(mode: 'ok' | 'fail'): string {
  return `${getBackendOrigin()}/api/demo/sink?mode=${mode}`
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) {
        message = body.detail
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function computeHmacSha256(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const hex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hex}`
}

export const apiClient = {
  listEndpoints(): Promise<Endpoint[]> {
    return requestJson<Endpoint[]>('/api/endpoints')
  },

  createEndpoint(data: EndpointCreate): Promise<Endpoint> {
    return requestJson<Endpoint>('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  deleteEndpoint(endpointId: string): Promise<void> {
    return requestJson<void>(`/api/endpoints/${endpointId}`, {
      method: 'DELETE',
    })
  },

  listEndpointEvents(endpointId: string, limit = 50): Promise<WebhookEventSummary[]> {
    return requestJson<WebhookEventSummary[]>(`/api/endpoints/${endpointId}/events?limit=${limit}`)
  },

  getEventDetail(eventId: string): Promise<WebhookEventDetail> {
    return requestJson<WebhookEventDetail>(`/api/events/${eventId}`)
  },

  replayEvent(eventId: string): Promise<WebhookEventDetail> {
    return requestJson<WebhookEventDetail>(`/api/events/${eventId}/replay`, {
      method: 'POST',
    })
  },

  async sendTestWebhook(
    slug: string,
    options: {
      payload: string
      idempotencyKey?: string
      signingSecret?: string | null
      tamperSignature?: boolean
    },
  ): Promise<{ httpStatus: number; data: IngestResult | { detail: string }; signatureUsed: string | null }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Test-Source': 'relay-browser-simulator',
    }

    if (options.idempotencyKey?.trim()) {
      headers['X-Idempotency-Key'] = options.idempotencyKey.trim()
    }

    let signatureUsed: string | null = null
    if (options.signingSecret) {
      signatureUsed = options.tamperSignature
        ? 'sha256=000000000000000000000000000000000000000000000000000000000000dead'
        : await computeHmacSha256(options.signingSecret, options.payload)
      headers['X-Webhook-Signature'] = signatureUsed
    }

    const response = await fetch(`${API_BASE}/api/ingest/${slug}`, {
      method: 'POST',
      headers,
      body: options.payload,
    })

    const data = (await response.json()) as IngestResult | { detail: string }
    return {
      httpStatus: response.status,
      data,
      signatureUsed,
    }
  },
}
