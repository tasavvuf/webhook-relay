import { useEffect, useId, useRef, useState } from 'react'
import type { Endpoint, EndpointCreate } from '../types'

interface SidebarProps {
  endpoints: Endpoint[]
  selectedId: string | null
  loading: boolean
  onSelect: (endpoint: Endpoint) => void
  onCreate: (data: EndpointCreate) => Promise<void>
  onDelete: (endpoint: Endpoint) => Promise<void>
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function Sidebar({
  endpoints,
  selectedId,
  loading,
  onSelect,
  onCreate,
  onDelete,
}: SidebarProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const targetInputRef = useRef<HTMLInputElement>(null)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [useSecret, setUseSecret] = useState(true)
  const [touched, setTouched] = useState<{ name: boolean; targetUrl: boolean }>({
    name: false,
    targetUrl: false,
  })
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const titleId = useId()
  const nameId = useId()
  const nameErrorId = useId()
  const targetId = useId()
  const targetErrorId = useId()
  const secretCheckboxId = useId()

  const nameError =
    (touched.name || submitAttempted) && !name.trim()
      ? 'Endpoint name is required.'
      : null
  const targetUrlError =
    (touched.targetUrl || submitAttempted) && !isValidHttpUrl(targetUrl)
      ? 'Enter a valid http:// or https:// destination URL.'
      : null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isDialogOpen && !dialog.open) {
      dialog.showModal()
    } else if (!isDialogOpen && dialog.open) {
      dialog.close()
    }
  }, [isDialogOpen])

  // Fallback light-dismiss for browsers without <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return

    let pressedOutside = false
    const isOutside = (e: PointerEvent) => {
      const rect = dialog.getBoundingClientRect()
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      )
    }

    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close()
      }
      pressedOutside = false
    }

    dialog.addEventListener('pointerdown', onPointerDown)
    dialog.addEventListener('pointerup', onPointerUp)
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown)
      dialog.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  const openModal = () => {
    setName('')
    setTargetUrl('')
    setUseSecret(true)
    setTouched({ name: false, targetUrl: false })
    setSubmitAttempted(false)
    setFormError(null)
    setIsDialogOpen(true)
  }

  const closeModal = () => {
    setIsDialogOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)
    setFormError(null)

    if (!name.trim()) {
      nameInputRef.current?.focus()
      return
    }
    if (!isValidHttpUrl(targetUrl)) {
      targetInputRef.current?.focus()
      return
    }

    setSubmitting(true)
    try {
      await onCreate({
        name: name.trim(),
        target_url: targetUrl.trim(),
        use_secret: useSecret,
      })
      closeModal()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create endpoint')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (ep: Endpoint) => {
    setDeletingId(ep.id)
    try {
      await onDelete(ep)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <aside
      aria-label="Webhook endpoints"
      className="w-[260px] shrink-0 bg-[#111113] border-r border-[#27272A] flex flex-col h-full"
    >
      <div className="px-4 py-3.5 border-b border-[#27272A] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-sm bg-emerald-400 shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight text-zinc-50 truncate-cell">
            Webhook Relay
          </span>
        </div>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-[#27272A]">
          v0.1
        </span>
      </div>

      <div className="p-3 border-b border-[#27272A]">
        <button
          type="button"
          onClick={openModal}
          className="w-full min-h-[36px] px-3 py-1.5 rounded-md bg-zinc-50 text-zinc-950 hover:bg-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 cursor-pointer"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          New Endpoint
        </button>
      </div>

      <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Endpoints
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{endpoints.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && endpoints.length === 0 ? (
          <p className="px-2 py-4 text-xs text-zinc-500 font-mono">Loading endpoints...</p>
        ) : endpoints.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-zinc-400">No endpoints yet.</p>
            <p className="text-[11px] text-zinc-500 mt-1">
              Create one to generate an ingest URL.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {endpoints.map((ep) => {
              const isSelected = ep.id === selectedId
              return (
                <li key={ep.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelect(ep)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`w-full text-left px-2.5 py-2 pr-8 rounded-md border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-400 ${
                      isSelected
                        ? 'bg-zinc-800/80 border-zinc-700 text-zinc-50'
                        : 'bg-transparent border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-xs font-medium truncate-cell">{ep.name}</span>
                      <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                        {ep.event_count}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span className="font-mono text-[11px] text-zinc-500 truncate-cell">
                        {ep.slug}
                      </span>
                      {ep.failed_count > 0 && (
                        <span className="font-mono text-[10px] text-rose-400 shrink-0">
                          {ep.failed_count} failed
                        </span>
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(ep)}
                    disabled={deletingId === ep.id}
                    aria-label={`Delete ${ep.name}`}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[24px] min-h-[24px] flex items-center justify-center rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer disabled:opacity-40"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path
                        d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => {
          if (dialogRef.current) {
            dialogRef.current.returnValue = ''
          }
          setIsDialogOpen(false)
        }}
        {...({ closedby: 'any' } as Record<string, string>)}
        className="m-auto w-full max-w-md rounded-lg bg-[#111113] border border-[#27272A] p-0 text-[#FAFAFA] shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-[#27272A] flex items-center justify-between">
          <h1 id={titleId} className="text-sm font-semibold text-zinc-50">
            Create Ingestion Endpoint
          </h1>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close dialog"
            className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-xs font-medium text-zinc-300">
              Name <span aria-hidden="true" className="text-rose-400">*</span>
            </label>
            <input
              ref={nameInputRef}
              id={nameId}
              name="name"
              type="text"
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setFormError(null)
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              placeholder="Stripe Production"
              className="w-full min-h-[38px] px-3 py-2 rounded-md bg-[#09090B] border border-[#27272A] text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            {nameError && (
              <p id={nameErrorId} className="text-xs text-rose-400">
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={targetId} className="block text-xs font-medium text-zinc-300">
              Target URL <span aria-hidden="true" className="text-rose-400">*</span>
            </label>
            <input
              ref={targetInputRef}
              id={targetId}
              name="target_url"
              type="url"
              required
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={targetUrl}
              onChange={(e) => {
                setTargetUrl(e.target.value)
                setFormError(null)
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, targetUrl: true }))}
              aria-invalid={targetUrlError ? 'true' : undefined}
              aria-describedby={targetUrlError ? targetErrorId : undefined}
              placeholder="https://httpbin.org/post"
              className="w-full min-h-[38px] px-3 py-2 rounded-md bg-[#09090B] border border-[#27272A] font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            {targetUrlError && (
              <p id={targetErrorId} className="text-xs text-rose-400">
                {targetUrlError}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2.5 pt-1">
            <input
              id={secretCheckboxId}
              name="use_secret"
              type="checkbox"
              checked={useSecret}
              onChange={(e) => setUseSecret(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-[#27272A] bg-[#09090B] accent-emerald-500 cursor-pointer"
            />
            <label htmlFor={secretCheckboxId} className="text-xs text-zinc-300 cursor-pointer">
              Generate HMAC-SHA256 signing secret (<code className="font-mono text-zinc-400">whsec_...</code>)
            </label>
          </div>

          {formError && (
            <div
              role="alert"
              className="px-3 py-2 rounded-md bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300"
            >
              {formError}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#27272A]">
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[36px] px-3.5 py-1.5 rounded-md border border-[#27272A] bg-transparent hover:bg-zinc-800 text-xs font-medium text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[36px] px-4 py-1.5 rounded-md bg-zinc-50 text-zinc-950 hover:bg-zinc-200 text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Creating...' : 'Create Endpoint'}
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  )
}
