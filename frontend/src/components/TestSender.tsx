import { useId, useState } from 'react'
import { apiClient } from '../api/client'
import type { Endpoint } from '../types'

interface TestSenderProps {
  endpoint: Endpoint
  isOpen: boolean
  onClose: () => void
  onEventSent: (eventId: string | null) => Promise<void>
}

interface LastResponse {
  httpStatus: number
  statusLabel: string
  eventId?: string
  signatureUsed: string | null
}

function makeDefaultKey(): string {
  return `evt_test_${Math.random().toString(36).slice(2, 10)}`
}

const DEFAULT_PAYLOAD = JSON.stringify(
  {
    event: 'invoice.paid',
    customer: 'cus_9s8d7f',
    amount: 4900,
    currency: 'usd',
  },
  null,
  2,
)

export function TestSender({ endpoint, isOpen, onClose, onEventSent }: TestSenderProps) {
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD)
  const [idempotencyKey, setIdempotencyKey] = useState(makeDefaultKey)
  const [tamperSignature, setTamperSignature] = useState(false)
  const [sending, setSending] = useState(false)
  const [lastResult, setLastResult] = useState<LastResponse | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const keyInputId = useId()
  const payloadInputId = useId()
  const tamperCheckboxId = useId()

  if (!isOpen) return null

  const dispatchWebhook = async (useSameKey: boolean) => {
    const activeKey = useSameKey ? idempotencyKey : makeDefaultKey()
    if (!useSameKey) {
      setIdempotencyKey(activeKey)
    }

    setSending(true)
    setSendError(null)
    try {
      const res = await apiClient.sendTestWebhook(endpoint.slug, {
        payload,
        idempotencyKey: activeKey,
        signingSecret: endpoint.signing_secret,
        tamperSignature,
      })

      const body = res.data
      if ('event_id' in body) {
        setLastResult({
          httpStatus: res.httpStatus,
          statusLabel: body.status,
          eventId: body.event_id,
          signatureUsed: res.signatureUsed,
        })
        await onEventSent(body.event_id)
      } else {
        setLastResult({
          httpStatus: res.httpStatus,
          statusLabel: body.detail ?? 'rejected',
          signatureUsed: res.signatureUsed,
        })
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send test webhook')
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      aria-label="Test webhook sender"
      className="bg-[#111113] border-b border-[#27272A] px-5 py-3.5 shrink-0"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
            Simulate Webhook
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">
            {endpoint.signing_secret
              ? 'Web Crypto HMAC-SHA256 signing active'
              : 'Unsigned endpoint'}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="min-h-[24px] px-2 py-0.5 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
        <div className="space-y-1.5">
          <label htmlFor={payloadInputId} className="block text-[11px] font-medium text-zinc-400">
            JSON Payload
          </label>
          <textarea
            id={payloadInputId}
            rows={4}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-md bg-[#09090B] border border-[#27272A] font-mono text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y"
          />
        </div>

        <div className="flex flex-col justify-between gap-3">
          <div className="space-y-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor={keyInputId} className="text-[11px] font-medium text-zinc-400">
                  X-Idempotency-Key
                </label>
                <button
                  type="button"
                  onClick={() => setIdempotencyKey(makeDefaultKey())}
                  className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                >
                  Regenerate
                </button>
              </div>
              <input
                id={keyInputId}
                type="text"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="(leave blank for SHA-256 fallback)"
                className="w-full min-h-[34px] px-2.5 py-1.5 rounded-md bg-[#09090B] border border-[#27272A] font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {endpoint.signing_secret && (
              <div className="flex items-center gap-2">
                <input
                  id={tamperCheckboxId}
                  type="checkbox"
                  checked={tamperSignature}
                  onChange={(e) => setTamperSignature(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[#27272A] bg-[#09090B] accent-rose-500 cursor-pointer"
                />
                <label htmlFor={tamperCheckboxId} className="text-xs text-zinc-400 cursor-pointer">
                  Tamper HMAC signature (test 401)
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={() => void dispatchWebhook(true)}
              className="flex-1 min-h-[34px] px-3 py-1.5 rounded-md bg-zinc-50 text-zinc-950 hover:bg-zinc-200 text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {sending ? 'Sending...' : 'Send Event'}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void dispatchWebhook(false)}
              className="min-h-[34px] px-3 py-1.5 rounded-md border border-[#27272A] bg-[#09090B] hover:bg-zinc-800 text-xs font-medium text-zinc-200 disabled:opacity-50 cursor-pointer"
            >
              New Key &amp; Send
            </button>
          </div>
        </div>
      </div>

      {sendError && (
        <div
          role="alert"
          className="mt-3 px-3 py-1.5 rounded bg-rose-950/50 border border-rose-800/60 font-mono text-xs text-rose-300"
        >
          {sendError}
        </div>
      )}

      {lastResult && (
        <div className="mt-3 px-3 py-2 rounded-md bg-[#09090B] border border-[#27272A] flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`px-1.5 py-0.5 rounded border text-[11px] ${
                lastResult.httpStatus === 202
                  ? 'text-emerald-400 bg-emerald-950/50 border-emerald-800/60'
                  : lastResult.httpStatus === 200
                    ? 'text-amber-400 bg-amber-950/50 border-amber-800/60'
                    : 'text-rose-400 bg-rose-950/50 border-rose-800/60'
              }`}
            >
              HTTP {lastResult.httpStatus}
            </span>
            <span className="text-zinc-200">{lastResult.statusLabel}</span>
            {lastResult.httpStatus === 202 && (
              <span className="text-zinc-500">
                (Click &quot;Send Event&quot; again to test idempotency)
              </span>
            )}
          </div>

          {lastResult.signatureUsed && (
            <span className="text-[11px] text-zinc-500 truncate-cell max-w-md">
              X-Webhook-Signature: {lastResult.signatureUsed}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
