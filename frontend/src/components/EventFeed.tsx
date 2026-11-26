import { useId } from 'react'
import type { WebhookEventSummary } from '../types'
import { StatusBadge } from './StatusBadge'

interface EventFeedProps {
  events: WebhookEventSummary[]
  selectedEventId: string | null
  loading: boolean
  isPolling: boolean
  onSelectEvent: (eventId: string) => void
  onRefresh: () => void
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function EventFeed({
  events,
  selectedEventId,
  loading,
  isPolling,
  onSelectEvent,
  onRefresh,
}: EventFeedProps) {
  const captionId = useId()

  return (
    <section
      aria-label="Webhook event log"
      className="flex flex-col min-h-0 bg-[#09090B] border-b lg:border-b-0 lg:border-r border-[#27272A]"
    >
      <div className="px-4 py-2.5 bg-[#111113] border-b border-[#27272A] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Delivery Feed
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">{events.length}</span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-500">
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${
                isPolling ? 'bg-emerald-400' : 'bg-zinc-600'
              }`}
            />
            {isPolling ? '3s live' : 'paused'}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[26px] px-2.5 py-1 rounded border border-[#27272A] bg-[#09090B] hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8 text-xs font-mono text-zinc-500">
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <p className="text-xs font-medium text-zinc-300">No events recorded yet</p>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
            Send a POST request to the ingest URL or use the Test Webhook bar above to trigger a
            delivery.
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-zinc-500"
        >
          <table className="w-full table-fixed border-separate border-spacing-0 text-left">
            <caption id={captionId} className="sr-only">
              Webhook delivery events ordered newest first
            </caption>
            <thead className="sticky top-0 z-10 bg-[#111113]">
              <tr className="border-b border-[#27272A]">
                <th
                  scope="col"
                  className="w-[124px] px-3.5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-[#27272A]"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="w-[68px] px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-[#27272A]"
                >
                  HTTP
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-[#27272A]"
                >
                  Idempotency Key
                </th>
                <th
                  scope="col"
                  className="w-[76px] px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-[#27272A]"
                >
                  Tries
                </th>
                <th
                  scope="col"
                  className="w-[96px] px-3.5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-[#27272A] text-right"
                >
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const isSelected = ev.id === selectedEventId
                return (
                  <tr
                    key={ev.id}
                    onClick={() => onSelectEvent(ev.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-zinc-900/90' : 'hover:bg-zinc-900/50'
                    }`}
                  >
                    <td className="px-3.5 py-2.5 border-b border-[#27272A]/70 align-middle">
                      <StatusBadge status={ev.status} />
                    </td>
                    <td className="px-2.5 py-2.5 border-b border-[#27272A]/70 font-mono text-xs text-zinc-300 align-middle">
                      {ev.response_status ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 border-b border-[#27272A]/70 align-middle">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectEvent(ev.id)
                        }}
                        aria-pressed={isSelected}
                        className="w-full text-left font-mono text-xs text-zinc-200 truncate-cell block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 cursor-pointer"
                      >
                        {ev.idempotency_key}
                      </button>
                    </td>
                    <td className="px-2.5 py-2.5 border-b border-[#27272A]/70 font-mono text-xs text-zinc-400 align-middle">
                      {ev.attempts}/3
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-[#27272A]/70 font-mono text-xs text-zinc-400 align-middle text-right">
                      {formatTimestamp(ev.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
