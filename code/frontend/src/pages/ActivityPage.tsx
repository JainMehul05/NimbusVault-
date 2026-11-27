import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Filter, RotateCcw, SearchX } from 'lucide-react'
import { activityApi, type ActivityAction, type ActivityLogEntry, type ResourceType } from '@services/activity'
import { filesApi, flattenTree, foldersApi } from '@services/files'
import { formatDayHeading, getErrorMessage } from '@lib/format'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { Field, Input, Select } from '@components/ui/Input'
import { EmptyState, ErrorState, Skeleton } from '@components/ui/primitives'
import { ActivityItem, type NameResolver } from '@components/activity/ActivityItem'

/** Only actions the backend currently records for the signed-in user. */
const ACTION_OPTIONS: Array<{ value: ActivityAction | ''; label: string }> = [
  { value: '', label: 'All activity' },
  { value: 'file_upload', label: 'Uploads' },
  { value: 'file_download', label: 'Downloads' },
  { value: 'file_rename', label: 'File renames' },
  { value: 'file_move', label: 'File moves' },
  { value: 'file_delete', label: 'File deletions' },
  { value: 'file_restore', label: 'File restores' },
  { value: 'file_purge', label: 'Permanent deletions' },
  { value: 'folder_create', label: 'Folders created' },
  { value: 'folder_rename', label: 'Folder renames' },
  { value: 'folder_move', label: 'Folder moves' },
  { value: 'folder_delete', label: 'Folder deletions' },
  { value: 'share_create', label: 'Access granted' },
  { value: 'share_update', label: 'Access changed' },
  { value: 'share_revoke', label: 'Access removed' },
  { value: 'share_link_create', label: 'Share links created' },
  { value: 'share_link_revoke', label: 'Share links revoked' },
  { value: 'share_access', label: 'Share link visits' },
  { value: 'auth_login', label: 'Sign-ins' },
  { value: 'auth_failed_login', label: 'Failed sign-ins' },
  { value: 'auth_password_change', label: 'Password changes' },
  { value: 'auth_session_revoke', label: 'Devices signed out' },
  { value: 'ai_query', label: 'AI questions' },
]

const TYPE_OPTIONS: Array<{ value: ResourceType | ''; label: string }> = [
  { value: '', label: 'All items' },
  { value: 'FILE', label: 'Files' },
  { value: 'FOLDER', label: 'Folders' },
  { value: 'SHARE_LINK', label: 'Share links' },
]

interface Filters { action: ActivityAction | ''; resourceType: ResourceType | ''; from: string; to: string }
const EMPTY: Filters = { action: '', resourceType: '', from: '', to: '' }
const PAGE_SIZE = 25

export function ActivityPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [page, setPage] = useState(1)
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 })
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<{ files: Map<string, string>; folders: Map<string, string> }>({ files: new Map(), folders: new Map() })
  const [showFilters, setShowFilters] = useState(false)

  const rangeError = filters.from && filters.to && filters.from > filters.to ? 'Start date must be before the end date.' : null

  const load = useCallback(async () => {
    if (rangeError) return
    setState('loading')
    try {
      const res = await activityApi.getActivityLog({
        page,
        limit: PAGE_SIZE,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
        // Backend expects ISO datetimes; cover the whole selected days in local time.
        startDate: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
        endDate: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
      })
      setEntries(res.data?.entries ?? [])
      setMeta({ total: res.data?.pagination.total ?? 0, totalPages: res.data?.pagination.totalPages ?? 0 })
      setState('ready')
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load activity.'))
      setState('error')
    }
  }, [page, filters, rangeError])

  useEffect(() => { load() }, [load])

  // Resolve ids to names for entries whose metadata doesn't include one.
  useEffect(() => {
    Promise.allSettled([foldersApi.tree(), filesApi.list({ limit: 100 })]).then(([tree, files]) => {
      setNames({
        folders: new Map(tree.status === 'fulfilled' ? flattenTree(tree.value).map((f) => [f.id, f.name]) : []),
        files: new Map(files.status === 'fulfilled' ? files.value.files.map((f) => [f.id, f.filename]) : []),
      })
    })
  }, [])

  const resolve: NameResolver = useCallback(
    (type, id) => (id ? (type === 'FOLDER' ? names.folders.get(id) : names.files.get(id)) : undefined),
    [names]
  )

  const groups = useMemo(() => {
    const out: Array<{ day: string; items: ActivityLogEntry[] }> = []
    for (const e of entries) {
      const day = formatDayHeading(e.createdAt)
      const last = out[out.length - 1]
      if (last?.day === day) last.items.push(e)
      else out.push({ day, items: [e] })
    }
    return out
  }, [entries])

  const update = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1) }
  const activeFilters = Object.values(filters).filter(Boolean).length
  const reset = () => { setFilters(EMPTY); setPage(1) }

  return (
    <AppShell title="Activity" description="Your actions, plus what collaborators and share-link visitors did with your files.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="order-2 min-w-0 lg:order-1">
          {state === 'error' ? (
            <div className="border border-border bg-surface"><ErrorState title="Couldn’t load activity" message={error} onRetry={load} /></div>
          ) : state === 'loading' && entries.length === 0 ? (
            <div className="border border-border bg-surface p-5" aria-busy="true" aria-label="Loading activity">
              <Skeleton className="mb-5 h-3 w-24" />
              <div className="space-y-5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-3/5" /><Skeleton className="h-3 w-1/4" /></div></div>)}</div>
            </div>
          ) : entries.length === 0 ? (
            <div className="border border-dashed border-border-strong bg-surface">
              {activeFilters ? (
                <EmptyState icon={SearchX} title="No activity matches these filters" description="Try a wider date range or a different event type." action={<Button variant="secondary" onClick={reset}><RotateCcw className="h-4 w-4" /> Reset filters</Button>} />
              ) : (
                <EmptyState icon={Activity} title="No activity yet" description="Uploads, downloads, changes, sharing, and sign-ins — yours and others’ on your files — are recorded here." />
              )}
            </div>
          ) : (
            <div className={state === 'loading' ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={state === 'loading'}>
              <div className="border border-border bg-surface">
                {groups.map((g) => (
                  <section key={g.day} aria-label={g.day} className="border-b border-border px-4 py-4 last:border-0 sm:px-5">
                    <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">{g.day}</h2>
                    {/* Timeline rail */}
                    <ol className="relative before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-border">
                      {g.items.map((e) => <ActivityItem key={e.id} entry={e} resolve={resolve} showTime="clock" />)}
                    </ol>
                  </section>
                ))}
              </div>
              {meta.totalPages > 1 && (
                <nav className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
                  <p className="text-sm text-muted-foreground">Page {page} of {meta.totalPages} · {meta.total} events</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
                    <Button size="sm" variant="secondary" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Older</Button>
                  </div>
                </nav>
              )}
            </div>
          )}
        </div>

        <aside className="order-1 lg:order-2" aria-label="Activity filters">
          <div className="border border-border bg-surface lg:sticky lg:top-10">
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className="flex h-12 w-full items-center justify-between px-4 text-sm font-semibold text-foreground lg:pointer-events-none"
              aria-expanded={showFilters}
              aria-controls="activity-filters"
            >
              <span className="flex items-center gap-2"><Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Filters {activeFilters > 0 && <span className="rounded-sm bg-primary/15 px-1.5 text-2xs text-primary">{activeFilters}</span>}</span>
              <span className="text-xs font-normal text-muted-foreground lg:hidden">{showFilters ? 'Hide' : 'Show'}</span>
            </button>
            <div id="activity-filters" className={`${showFilters ? 'block' : 'hidden'} space-y-4 border-t border-border p-4 lg:block`}>
              <Field label="Event">
                {({ id }) => (
                  <Select id={id} value={filters.action} onChange={(e) => update({ action: e.target.value as Filters['action'] })}>
                    {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Item type">
                {({ id }) => (
                  <Select id={id} value={filters.resourceType} onChange={(e) => update({ resourceType: e.target.value as Filters['resourceType'] })}>
                    {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                <Field label="From">
                  {({ id }) => <Input id={id} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />}
                </Field>
                <Field label="To" error={rangeError}>
                  {({ id, describedBy, invalid }) => <Input id={id} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} aria-describedby={describedBy} invalid={invalid} />}
                </Field>
              </div>
              <Button variant="ghost" size="sm" className="w-full" onClick={reset} disabled={!activeFilters}>
                <RotateCcw className="h-4 w-4" /> Reset filters
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  )
}
