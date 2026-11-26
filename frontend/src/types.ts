export type EventStatus = 'pending' | 'retrying' | 'delivered' | 'failed'

export interface Endpoint {
  id: string
  name: string
  slug: string
  target_url: string
  signing_secret: string | null
  is_active: boolean
  created_at: string
  event_count: number
  delivered_count: number
  failed_count: number
}

export interface EndpointCreate {
  name: string
  target_url: string
  use_secret: boolean
  signing_secret?: string | null
}

export interface WebhookEventSummary {
  id: string
  endpoint_id: string
  idempotency_key: string
  status: EventStatus
  attempts: number
  response_status: number | null
  error_message: string | null
  created_at: string
  last_attempt_at: string | null
}

export interface WebhookEventDetail extends WebhookEventSummary {
  request_headers: Record<string, string>
  payload: string
  response_body: string | null
}

export interface IngestResult {
  event_id: string
  status: 'queued' | 'duplicate_ignored'
}
