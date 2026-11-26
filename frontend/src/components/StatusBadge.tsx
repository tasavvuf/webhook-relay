import type { EventStatus } from '../types'

const STATUS_STYLES: Record<EventStatus, string> = {
  delivered: 'text-emerald-400 bg-emerald-950/50 border-emerald-800/60',
  retrying: 'text-amber-400 bg-amber-950/50 border-amber-800/60',
  pending: 'text-amber-400 bg-amber-950/50 border-amber-800/60',
  failed: 'text-rose-400 bg-rose-950/50 border-rose-800/60',
}

interface StatusBadgeProps {
  status: EventStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono font-medium rounded border uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full ${
          status === 'delivered'
            ? 'bg-emerald-400'
            : status === 'failed'
              ? 'bg-rose-400'
              : 'bg-amber-400'
        }`}
      />
      {status}
    </span>
  )
}
