import { useCallback, useEffect, useState } from 'react'
import { apiClient, getPublicIngestUrl } from './api/client'
import { EventFeed } from './components/EventFeed'
import { EventInspector } from './components/EventInspector'
import { Sidebar } from './components/Sidebar'
import type {
  Endpoint,
  EndpointCreate,
  WebhookEventDetail,
  WebhookEventSummary,
} from './types'

export function App() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null)
  const [loadingEndpoints, setLoadingEndpoints] = useState(true)

  const [events, setEvents] = useState<WebhookEventSummary[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedEventDetail, setSelectedEventDetail] = useState<WebhookEventDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [replaying, setReplaying] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [showSecret, setShowSecret] = useState(false)
  const [copiedField, setCopiedField] = useState<'url' | 'secret' | null>(null)
  const [isTabVisible, setIsTabVisible] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  )

  const selectedEndpoint =
    endpoints.find((ep) => ep.id === selectedEndpointId) ?? endpoints[0] ?? null

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    let active = true
    apiClient
      .listEndpoints()
      .then((list) => {
        if (!active) return
        setEndpoints(list)
        setSelectedEndpointId((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev
          return list[0]?.id ?? null
        })
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load endpoints')
      })
      .finally(() => {
        if (active) setLoadingEndpoints(false)
      })

    return () => {
      active = false
    }
  }, [])

  const fetchEndpointData = useCallback(
    async (endpointId: string, activeEventId: string | null) => {
      try {
        const [eventList, endpointList] = await Promise.all([
          apiClient.listEndpointEvents(endpointId),
          apiClient.listEndpoints(),
        ])
        setEvents(eventList)
        setEndpoints(endpointList)

        const targetEventId =
          activeEventId && eventList.some((e) => e.id === activeEventId)
            ? activeEventId
            : (eventList[0]?.id ?? null)

        setSelectedEventId(targetEventId)
        if (targetEventId) {
          const detail = await apiClient.getEventDetail(targetEventId)
          setSelectedEventDetail(detail)
        } else {
          setSelectedEventDetail(null)
        }
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch events')
      } finally {
        setLoadingEvents(false)
      }
    },
    [],
  )

  // Initial load when switching endpoints
  useEffect(() => {
    if (!selectedEndpoint?.id) {
      setEvents([])
      setSelectedEventId(null)
      setSelectedEventDetail(null)
      return
    }
    let active = true
    setLoadingEvents(true)
    apiClient
      .listEndpointEvents(selectedEndpoint.id)
      .then(async (list) => {
        if (!active) return
        setEvents(list)
        const nextEventId = list[0]?.id ?? null
        setSelectedEventId(nextEventId)
        if (nextEventId) {
          const detail = await apiClient.getEventDetail(nextEventId)
          if (active) setSelectedEventDetail(detail)
        } else {
          setSelectedEventDetail(null)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load events')
        }
      })
      .finally(() => {
        if (active) setLoadingEvents(false)
      })

    return () => {
      active = false
    }
  }, [selectedEndpoint?.id])

  // 3-second polling only when endpoint is active and browser tab is visible
  useEffect(() => {
    if (!selectedEndpoint?.id || !isTabVisible) return
    const endpointId = selectedEndpoint.id
    const timer = window.setInterval(() => {
      void fetchEndpointData(endpointId, selectedEventId)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [selectedEndpoint?.id, selectedEventId, isTabVisible, fetchEndpointData])

  const handleSelectEvent = async (eventId: string) => {
    setSelectedEventId(eventId)
    setLoadingDetail(true)
    try {
      const detail = await apiClient.getEventDetail(eventId)
      setSelectedEventDetail(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event details')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleReplay = async (eventId: string) => {
    setReplaying(true)
    try {
      const updated = await apiClient.replayEvent(eventId)
      setSelectedEventDetail(updated)
      setStatusMessage('Event re-queued for delivery.')
      if (selectedEndpoint) {
        await fetchEndpointData(selectedEndpoint.id, eventId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed')
    } finally {
      setReplaying(false)
    }
  }

  const handleCreateEndpoint = async (data: EndpointCreate) => {
    const created = await apiClient.createEndpoint(data)
    setEndpoints((prev) => [created, ...prev])
    setSelectedEndpointId(created.id)
    setShowSecret(false)
    setStatusMessage(`Endpoint ${created.name} created.`)
  }

  const handleDeleteEndpoint = async (endpoint: Endpoint) => {
    await apiClient.deleteEndpoint(endpoint.id)
    setEndpoints((prev) => {
      const remaining = prev.filter((item) => item.id !== endpoint.id)
      if (selectedEndpointId === endpoint.id) {
        setSelectedEndpointId(remaining[0]?.id ?? null)
      }
      return remaining
    })
    setStatusMessage(`Deleted endpoint ${endpoint.name}.`)
  }

  const copyToClipboard = async (value: string, field: 'url' | 'secret') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      setStatusMessage(field === 'url' ? 'Copied ingestion URL.' : 'Copied signing secret.')
      window.setTimeout(() => {
        setCopiedField((curr) => (curr === field ? null : curr))
      }, 1500)
    } catch {
      // Ignore clipboard failures
    }
  }

  const ingestUrl = selectedEndpoint ? getPublicIngestUrl(selectedEndpoint.slug) : ''

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#09090B] text-[#FAFAFA] flex">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <Sidebar
        endpoints={endpoints}
        selectedId={selectedEndpoint?.id ?? null}
        loading={loadingEndpoints}
        onSelect={(ep) => {
          setSelectedEndpointId(ep.id)
          setShowSecret(false)
        }}
        onCreate={handleCreateEndpoint}
        onDelete={handleDeleteEndpoint}
      />

      <main className="flex-1 min-w-0 flex flex-col h-full">
        {error && (
          <div
            role="alert"
            className="px-4 py-2 bg-rose-950/60 border-b border-rose-800/60 text-xs text-rose-300 font-mono flex items-center justify-between gap-3"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-200 hover:text-white underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {selectedEndpoint ? (
          <>
            <header className="bg-[#111113] border-b border-[#27272A] px-5 py-3.5 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-base font-semibold text-zinc-50 truncate-cell">
                      {selectedEndpoint.name}
                    </h1>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-[#27272A] text-zinc-400">
                      {selectedEndpoint.slug}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-zinc-400 mt-0.5 truncate-cell">
                    Target: {selectedEndpoint.target_url}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#09090B] border border-[#27272A] max-w-full min-w-0">
                  <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider shrink-0">
                    POST
                  </span>
                  <code className="font-mono text-xs text-zinc-200 truncate-cell">
                    {ingestUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(ingestUrl, 'url')}
                    className="min-h-[24px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 shrink-0 cursor-pointer"
                  >
                    {copiedField === 'url' ? 'Copied' : 'Copy URL'}
                  </button>
                </div>

                {selectedEndpoint.signing_secret && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#09090B] border border-[#27272A] max-w-full min-w-0">
                    <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider shrink-0">
                      Secret
                    </span>
                    <code className="font-mono text-xs text-zinc-300 truncate-cell">
                      {showSecret
                        ? selectedEndpoint.signing_secret
                        : `${selectedEndpoint.signing_secret.slice(0, 10)}••••••••••••`}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowSecret((prev) => !prev)}
                      aria-pressed={showSecret}
                      className="min-h-[24px] px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-[#27272A] text-[11px] font-mono text-zinc-400 hover:text-zinc-200 shrink-0 cursor-pointer"
                    >
                      {showSecret ? 'Hide' : 'Reveal'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(selectedEndpoint.signing_secret ?? '', 'secret')
                      }
                      className="min-h-[24px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 shrink-0 cursor-pointer"
                    >
                      {copiedField === 'secret' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            </header>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
              <EventFeed
                events={events}
                selectedEventId={selectedEventId}
                loading={loadingEvents}
                isPolling={isTabVisible}
                onSelectEvent={(id) => void handleSelectEvent(id)}
                onRefresh={() => void fetchEndpointData(selectedEndpoint.id, selectedEventId)}
              />
              <EventInspector
                event={selectedEventDetail}
                loading={loadingDetail}
                replaying={replaying}
                onReplay={handleReplay}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <h1 className="text-sm font-medium text-zinc-200">No webhook endpoint selected</h1>
            <p className="text-xs text-zinc-500 mt-1.5 max-w-sm">
              Create an endpoint from the sidebar to receive a unique ingestion URL and inspect
              deliveries.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
