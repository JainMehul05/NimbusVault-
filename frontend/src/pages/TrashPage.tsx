import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { trashApi, type TrashItem, type TrashPage as TrashData } from '@services/trash'
import { formatFileSize, formatRelative, getErrorMessage } from '@lib/format'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { ConfirmDialog } from '@components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'
import { FileTypeIcon, FolderIcon } from '@components/files/FileTypeIcon'

type Pending = { kind: 'purge'; item: TrashItem } | { kind: 'empty' }

const daysLeft = (deletedAt: string, retentionDays: number) =>
  Math.max(0, Math.ceil((new Date(deletedAt).getTime() + retentionDays * 86_400_000 - Date.now()) / 86_400_000))

export function TrashPage() {
  const toast = useToast()
  const [data, setData] = useState<TrashData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async (page = 1) => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      setData(await trashApi.list(page))
      setState('ready')
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load the trash.'))
      setState('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const reload = async () => {
    // The last item on a page may have just gone.
    const page = data ? Math.min(data.pagination.page, Math.max(1, Math.ceil((data.pagination.total - 1) / data.pagination.limit))) : 1
    await load(page)
  }

  const restore = async (item: TrashItem) => {
    setBusyId(item.id)
    try {
      await trashApi.restore(item)
      toast.success(item.type === 'FOLDER' ? 'Folder restored' : 'File restored', item.name)
      await reload()
    } catch (err) {
      toast.error('Couldn’t restore', getErrorMessage(err, 'Please try again.'))
    } finally {
      setBusyId(null)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setWorking(true)
    try {
      if (pending.kind === 'empty') {
        await trashApi.empty()
        toast.success('Trash emptied')
        await load(1)
      } else {
        await trashApi.purge(pending.item)
        toast.success('Permanently deleted', pending.item.name)
        await reload()
      }
      setPending(null)
    } catch (err) {
      toast.error('Couldn’t delete', getErrorMessage(err, 'Please try again.'))
    } finally {
      setWorking(false)
    }
  }

  const items = data?.items ?? []
  const p = data?.pagination

  return (
    <AppShell
      title="Trash"
      description={data && data.retentionDays > 0 ? `Items are permanently deleted after ${data.retentionDays} days. They don’t count towards your storage.` : 'Deleted files and folders. They don’t count towards your storage.'}
      actions={items.length > 0 ? <Button variant="secondary" onClick={() => setPending({ kind: 'empty' })}><Trash2 className="h-4 w-4" /> Empty trash</Button> : undefined}
    >
      {state === 'error' ? (
        <div className="border border-border bg-surface"><ErrorState title="Couldn’t load the trash" message={error} onRetry={() => load()} /></div>
      ) : state === 'loading' ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading trash">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border-strong bg-surface">
          <EmptyState icon={Trash2} title="Trash is empty" description="Files and folders you delete stay here until they’re restored or permanently removed." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border border-border bg-surface">
            {items.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex min-h-16 items-center gap-3 px-4 py-2">
                {item.type === 'FOLDER' ? <FolderIcon /> : <FileTypeIcon filename={item.name} mimeType={item.mimeType} category={item.category} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={item.name}>{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.type === 'FOLDER' && `${item.itemCount} ${item.itemCount === 1 ? 'file' : 'files'} · `}
                    {formatFileSize(item.sizeBytes)} · Deleted {formatRelative(item.deletedAt)}
                    {data && data.retentionDays > 0 && ` · ${daysLeft(item.deletedAt, data.retentionDays)} days left`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" loading={busyId === item.id} onClick={() => restore(item)} aria-label={`Restore ${item.name}`}>
                    <RotateCcw className="h-4 w-4" /> <span className="hidden sm:inline">Restore</span>
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setPending({ kind: 'purge', item })} aria-label={`Permanently delete ${item.name}`} className="text-[#ff7b70] hover:bg-danger/10 hover:text-[#ff7b70]">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {p && p.totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
              <p className="text-sm text-muted-foreground">Page {p.page} of {p.totalPages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={p.page <= 1} onClick={() => load(p.page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={p.page >= p.totalPages} onClick={() => load(p.page + 1)}>Next</Button>
              </div>
            </nav>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pending}
        loading={working}
        title={pending?.kind === 'empty' ? 'Empty trash?' : 'Permanently delete?'}
        confirmLabel={pending?.kind === 'empty' ? 'Empty trash' : 'Delete forever'}
        description={
          pending?.kind === 'purge' ? (
            <>“<strong className="text-foreground">{pending.item.name}</strong>”{pending.item.type === 'FOLDER' ? ' and everything inside it' : ''} will be gone for good. This can’t be undone.</>
          ) : (
            <>All {p?.total ?? ''} items will be gone for good. This can’t be undone.</>
          )
        }
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </AppShell>
  )
}
