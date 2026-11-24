import { useCallback, useEffect, useState } from 'react'
import { Share2, Users } from 'lucide-react'
import { sharingApi, type SharedByMeResponse } from '@services/sharing'
import { getErrorMessage } from '@lib/format'
import { Button } from './ui/Button'
import { EmptyState, ErrorState, RoleBadge, Skeleton } from './ui/primitives'
import { FileTypeIcon, FolderIcon } from './files/FileTypeIcon'
import { ShareDialog, type ShareTarget } from './ShareDialog'

/** Everything the signed-in user has given other people access to, with a way to manage it. */
export function SharedByMe({ query }: { query: string }) {
  const [data, setData] = useState<SharedByMeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<ShareTarget | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData((await sharingApi.getSharedByMe()).data ?? { files: [], folders: [] })
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load items you’ve shared.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <div className="border border-border bg-surface"><ErrorState title="Couldn’t load items you’ve shared" message={error} onRetry={load} /></div>
  if (!data) return <div className="space-y-2" aria-busy="true" aria-label="Loading items you’ve shared">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>

  const q = query.trim().toLowerCase()
  const items = [
    ...data.folders.map((f) => ({ type: 'FOLDER' as const, id: f.id, name: f.name, shares: f.shares })),
    ...data.files.map((f) => ({ type: 'FILE' as const, id: f.id, name: f.filename, shares: f.shares })),
  ].filter((i) => !q || i.name.toLowerCase().includes(q) || i.shares.some((s) => `${s.grantee.name} ${s.grantee.email}`.toLowerCase().includes(q)))

  return (
    <>
      {items.length === 0 ? (
        <div className="border border-dashed border-border-strong bg-surface">
          {q
            ? <EmptyState icon={Share2} title="No matching items" description="Try a different name or person." />
            : <EmptyState icon={Share2} title="You haven’t shared anything yet" description="Share a file or folder from My Files and it will appear here." />}
        </div>
      ) : (
        <ul className="divide-y divide-border border border-border bg-surface">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {item.type === 'FOLDER' ? <FolderIcon /> : <FileTypeIcon filename={item.name} />}
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium text-foreground" title={item.name}>{item.name}</p>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {item.shares.map((s) => (
                    <li key={s.grantee.id} className="flex items-center gap-1.5 text-xs text-muted-foreground" title={s.grantee.email}>
                      {s.grantee.name} <RoleBadge role={s.level} />
                    </li>
                  ))}
                </ul>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setTarget({ resourceType: item.type, resourceId: item.id, resourceName: item.name })} aria-label={`Manage access to ${item.name}`}>
                <Users className="h-4 w-4" /> Manage
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ShareDialog open={!!target} target={target} onClose={() => { setTarget(null); load() }} />
    </>
  )
}
