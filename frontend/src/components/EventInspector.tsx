import { useState } from 'react'
import type { WebhookEventDetail } from '../types'
import { StatusBadge } from './StatusBadge'

interface EventInspectorProps {
  event: WebhookEventDetail | null
  loading: boolean
  replaying: boolean
  onReplay: (eventId: string) => Promise<void>
}

function formatJsonPayload(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export function EventInspector({
  event,
  loading,
  replaying,
  onReplay,
}: EventInspectorProps) {
  const [copiedPayload, setCopiedPayload] = useState(false)

  const copyPayload = async () => {
    if (!event) return
    try {
      await navigator.clipboard.writeText(event.payload)
      setCopiedPayload(true)
      window.setTimeout(() => setCopiedPayload(false), 1500)
    } catch {
      // Ignore clipboard failures
    }
  }

  if (loading && !event) {
    return (
      <section
        aria-label="Event inspector"
        className="flex items-center justify-center bg-[#111113] p-8 text-xs font-mono text-zinc-500"
      >
        Loading event payload...
      </section>
    )
  }

  if (!event) {
    return (
      <section
        aria-label="Event inspector"
        className="flex flex-col items-center justify-center bg-[#111113] p-8 text-center"
      >
        <p className="text-xs font-medium text-zinc-300">Select an event to inspect</p>
        <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
          View raw request headers, JSON payload, target response body, and trigger manual replays.
        </p>
      </section>
    )
  }

  const headerEntries = Object.entries(event.request_headers)
  const formattedPayload = formatJsonPayload(event.payload)

  return (
    <section
      aria-label="Event inspector"
      className="flex flex-col min-h-0 bg-[#111113] overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-[#27272A] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 shrink-0">
            Inspector
          </h2>
          <code className="font-mono text-[11px] text-zinc-400 truncate-cell">
            {event.id}
          </code>
        </div>

        <button
          type="button"
          onClick={() => void onReplay(event.id)}
          disabled={replaying}
          className="min-h-[30px] px-3 py-1 rounded-md bg-zinc-50 text-zinc-950 hover:bg-zinc-200 text-xs font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path
              d="M13 8a5 5 0 1 1-1.35-3.42M13 2.5v2.75h-2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {replaying ? 'Replaying...' : 'Replay Event'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-2.5 rounded-md bg-[#09090B] border border-[#27272A]">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Status
            </span>
            <div className="mt-1.5">
              <StatusBadge status={event.status} />
            </div>
          </div>

          <div className="p-2.5 rounded-md bg-[#09090B] border border-[#27272A]">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
              HTTP Status
            </span>
            <span className="block mt-1.5 font-mono text-xs text-zinc-100">
              {event.response_status ?? '—'}
            </span>
          </div>

          <div className="p-2.5 rounded-md bg-[#09090B] border border-[#27272A]">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Attempts
            </span>
            <span className="block mt-1.5 font-mono text-xs text-zinc-100">
              {event.attempts} / 3
            </span>
          </div>

          <div className="p-2.5 rounded-md bg-[#09090B] border border-[#27272A]">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Last Attempt
            </span>
            <span className="block mt-1.5 font-mono text-xs text-zinc-300 truncate-cell">
              {event.last_attempt_at
                ? new Date(event.last_attempt_at).toLocaleTimeString([], { hour12: false })
                : '—'}
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded-md bg-[#09090B] border border-[#27272A]">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
            Idempotency Key
          </span>
          <code className="block mt-1 font-mono text-xs text-zinc-200 break-all">
            {event.idempotency_key}
          </code>
        </div>

        {event.error_message && (
          <div
            role="alert"
            className="p-3 rounded-md bg-rose-950/40 border border-rose-800/60 text-xs font-mono text-rose-300 break-words"
          >
            {event.error_message}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Payload
            </h3>
            <button
              type="button"
              onClick={() => void copyPayload()}
              className="min-h-[24px] px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-[#27272A] text-[11px] font-mono text-zinc-300 cursor-pointer"
            >
              {copiedPayload ? 'Copied' : 'Copy Body'}
            </button>
          </div>
          <pre className="p-3 rounded-md bg-[#09090B] border border-[#27272A] font-mono text-xs text-zinc-200 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words">
            {formattedPayload || '(empty body)'}
          </pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Target Response
          </h3>
          <pre className="p-3 rounded-md bg-[#09090B] border border-[#27272A] font-mono text-xs text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words">
            {event.response_body ? event.response_body : '(no response body captured)'}
          </pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Request Headers ({headerEntries.length})
          </h3>
          <div className="rounded-md bg-[#09090B] border border-[#27272A] divide-y divide-[#27272A]/70 overflow-hidden">
            {headerEntries.length === 0 ? (
              <p className="p-3 font-mono text-xs text-zinc-500">No headers recorded.</p>
            ) : (
              headerEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="px-3 py-1.5 grid grid-cols-[minmax(120px,35%)_1fr] gap-3 text-xs font-mono"
                >
                  <span className="text-zinc-400 truncate-cell">{key}</span>
                  <span className="text-zinc-200 break-all">{value}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
