import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Folder, FolderOpen, Link2, MoreHorizontal, Pencil, Search, SearchX, Sparkles, Users, X } from 'lucide-react'
import { sharingApi, type SharedWithMeFile, type SharedWithMeFolder } from '@services/sharing'
import { filesApi, openDownload } from '@services/files'
import { formatFileSize, getErrorMessage, getFileTypeMeta } from '@lib/format'
import { cn } from '@lib/utils'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { Input } from '@components/ui/Input'
import { Avatar, EmptyState, ErrorState, RoleBadge, Skeleton } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'
import { FileTypeIcon, FolderIcon } from '@components/files/FileTypeIcon'
import { NameDialog } from '@components/files/FileDialogs'
import { DropdownMenu } from '@components/ui/DropdownMenu'
import { ShareLinkDialog } from '@components/ShareLinkDialog'
import { AiStatusBadge } from '@components/ai/AiStatusBadge'
import { DocumentInsightsDialog, type InsightsTarget } from '@components/ai/DocumentInsightsDialog'
import { AI_SUPPORTED_MIME } from '@services/ai'

type Tab = 'files' | 'folders'

function Owner({ owner }: { owner?: { name: string; email: string } }) {
  if (!owner) return <span className="text-subtle">Unknown</span>
  return (
    <span className="flex min-w-0 items-center gap-2" title={owner.email}>
      <Avatar name={owner.name} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{owner.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{owner.email}</span>
      </span>
    </span>
  )
}

export function SharedWithMePage() {
  const toast = useToast()
  const [files, setFiles] = useState<SharedWithMeFile[]>([])
  const [folders, setFolders] = useState<SharedWithMeFolder[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('files')
  const [query, setQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState<SharedWithMeFolder | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SharedWithMeFile | null>(null)
  const [linkFile, setLinkFile] = useState<SharedWithMeFile | null>(null)
  const [insights, setInsights] = useState<InsightsTarget | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await sharingApi.getSharedWithMe(1, 100)
      // A file can appear twice (direct share + inherited from a shared folder); keep the stronger role.
      const byId = new Map<string, SharedWithMeFile>()
      for (const f of res.data?.files ?? []) {
        const prev = byId.get(f.id)
        if (!prev || (prev.permission === 'VIEWER' && f.permission === 'EDITOR')) byId.set(f.id, f)
      }
      setFiles([...byId.values()].sort((a, b) => a.filename.localeCompare(b.filename)))
      setFolders([...(res.data?.folders ?? [])].sort((a, b) => a.name.localeCompare(b.name)))
      setState('ready')
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load items shared with you.'))
      setState('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const q = query.trim().toLowerCase()
  const visibleFiles = useMemo(
    () => files.filter((f) =>
      (!folderFilter || f.folderId === folderFilter.id) &&
      (!q || f.filename.toLowerCase().includes(q) || f.owner?.name.toLowerCase().includes(q) || f.owner?.email.toLowerCase().includes(q))),
    [files, q, folderFilter]
  )
  const visibleFolders = useMemo(
    () => folders.filter((f) => !q || f.name.toLowerCase().includes(q) || f.owner?.name.toLowerCase().includes(q)),
    [folders, q]
  )
  const filesInFolder = useCallback((id: string) => files.filter((f) => f.folderId === id).length, [files])

  const download = async (file: SharedWithMeFile) => {
    setDownloading(file.id)
    try { await openDownload(file.id) } catch (err) { toast.error('Download failed', getErrorMessage(err, 'Please try again.')) } finally { setDownloading(null) }
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'files', label: 'Files', count: files.length },
    { id: 'folders', label: 'Folders', count: folders.length },
  ]
  const nothingShared = state === 'ready' && files.length === 0 && folders.length === 0

  return (
    <AppShell title="Shared with me" description="Files and folders other people have given you access to.">
      {state === 'error' ? (
        <div className="border border-border bg-surface"><ErrorState title="Couldn’t load shared items" message={error} onRetry={load} /></div>
      ) : nothingShared ? (
        <div className="border border-dashed border-border-strong bg-surface">
          <EmptyState icon={Users} title="Nothing shared with you yet" description="When someone shares a file or folder with your email address, it shows up here with your role." />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div role="tablist" aria-label="Shared item types" className="flex border-b border-border md:border-0">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    '-mb-px flex h-10 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors md:mb-0',
                    tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  <span className={cn('rounded-sm px-1.5 text-2xs tabular-nums', tab === t.id ? 'bg-primary/15 text-primary' : 'bg-white/[0.06] text-muted-foreground')}>
                    {state === 'loading' ? '…' : t.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or owner" aria-label="Filter shared items" className="pl-9 [&::-webkit-search-cancel-button]:hidden" />
            </div>
          </div>

          {folderFilter && tab === 'files' && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              Showing files in <strong className="text-foreground">{folderFilter.name}</strong>
              <Button size="xs" variant="ghost" onClick={() => setFolderFilter(null)}><X className="h-3.5 w-3.5" /> Clear</Button>
            </div>
          )}

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {state === 'loading' ? (
              <div className="border border-border bg-surface">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex h-16 items-center gap-3 border-b border-border px-4 last:border-0">
                    <Skeleton className="h-7 w-7" /><Skeleton className="h-3 w-48" /><Skeleton className="ml-auto hidden h-6 w-40 md:block" /><Skeleton className="h-5 w-14" />
                  </div>
                ))}
              </div>
            ) : tab === 'files' ? (
              visibleFiles.length === 0 ? (
                <div className="border border-border bg-surface">
                  {q || folderFilter
                    ? <EmptyState icon={SearchX} title="No matching files" description="Try a different name or owner." action={<Button variant="secondary" size="sm" onClick={() => { setQuery(''); setFolderFilter(null) }}>Clear filters</Button>} />
                    : <EmptyState icon={Users} title="No files shared with you" description="Files shared directly with you, or inside a shared folder, appear here." />}
                </div>
              ) : (
                <div className="overflow-hidden border border-border bg-surface">
                  <table className="w-full table-fixed text-sm">
                    <thead className="border-b border-border bg-surface-sunken text-xs text-muted-foreground">
                      <tr className="h-10">
                        <th scope="col" className="px-4 text-left font-semibold">Name</th>
                        <th scope="col" className="hidden w-[240px] px-3 text-left font-semibold md:table-cell">Owner</th>
                        <th scope="col" className="hidden w-[96px] px-3 text-left font-semibold lg:table-cell">Size</th>
                        <th scope="col" className="w-[92px] px-3 text-left font-semibold">Your role</th>
                        <th scope="col" className="w-14 pr-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleFiles.map((file) => (
                        <tr key={file.id} className="h-16 transition-colors hover:bg-white/[0.02]">
                          <td className="px-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <FileTypeIcon filename={file.filename} mimeType={file.mimeType} category={file.category} />
                              <div className="min-w-0">
                                <p className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-foreground" title={file.filename}>{file.filename}</span><AiStatusBadge status={file.aiStatus} /></p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {getFileTypeMeta(file.filename, file.mimeType, file.category).label} · {formatFileSize(file.sizeBytes)}
                                  <span className="md:hidden"> · {file.owner?.name}</span>
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-3 md:table-cell"><Owner owner={file.owner} /></td>
                          <td className="hidden px-3 tabular-nums text-muted-foreground lg:table-cell">{formatFileSize(file.sizeBytes)}</td>
                          <td className="px-3"><RoleBadge role={file.permission} /></td>
                          <td className="pr-3 text-right">
                            {file.permission === 'EDITOR' || AI_SUPPORTED_MIME.includes(file.mimeType) ? (
                              <DropdownMenu
                                label={`Actions for ${file.filename}`}
                                items={[
                                  { label: 'Download', icon: Download, onSelect: () => download(file) },
                                  ...(AI_SUPPORTED_MIME.includes(file.mimeType) ? [{ label: 'Document insights', icon: Sparkles, onSelect: () => setInsights({ id: file.id, filename: file.filename }) }] : []),
                                  ...(file.permission === 'EDITOR' ? [
                                  { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(file), separated: true },
                                  { label: 'Create share link', icon: Link2, onSelect: () => setLinkFile(file) },
                                  ] : []),
                                ]}
                                trigger={(props) => (
                                  <button {...props} type="button" aria-label={`Actions for ${file.filename}`} className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                )}
                              />
                            ) : (
                              <Button size="icon-sm" variant="ghost" onClick={() => download(file)} loading={downloading === file.id} aria-label={`Download ${file.filename}`}>
                                {downloading !== file.id && <Download className="h-4 w-4" />}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : visibleFolders.length === 0 ? (
              <div className="border border-border bg-surface">
                {q
                  ? <EmptyState icon={SearchX} title="No matching folders" action={<Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear filter</Button>} />
                  : <EmptyState icon={Folder} title="No folders shared with you" description="When someone shares a folder, you get access to every file inside it." />}
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleFolders.map((folder) => {
                  const count = filesInFolder(folder.id)
                  return (
                    <li key={folder.id} className="flex flex-col border border-border bg-surface p-4 shadow-e1">
                      <div className="flex items-start gap-3">
                        <FolderIcon size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground" title={folder.name}>{folder.name}</p>
                          <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'file' : 'files'} available</p>
                        </div>
                        <RoleBadge role={folder.permission} />
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <Owner owner={folder.owner} />
                        <Link to={`/shared-with-me/folders/${folder.id}`} className="inline-flex h-8 items-center gap-1.5 rounded border border-border-strong bg-surface-raised px-3 text-sm font-semibold text-foreground hover:bg-[#1f1f1f]">
                          <FolderOpen className="h-4 w-4" aria-hidden="true" /> Open
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="mt-4 text-xs text-subtle">Viewers can view and download. Editors can also rename files and create share links. Owners can change or remove your access at any time.</p>
        </>
      )}
      <NameDialog
        open={!!renaming}
        mode="rename-file"
        initialValue={renaming?.filename ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return
          await filesApi.rename(renaming.id, name)
          setFiles((prev) => prev.map((f) => (f.id === renaming.id ? { ...f, filename: name } : f)))
          toast.success('File renamed', name)
        }}
      />
      <ShareLinkDialog open={!!linkFile} file={linkFile} onClose={() => setLinkFile(null)} />
      <DocumentInsightsDialog target={insights} onClose={() => setInsights(null)} onStatusChange={load} />
    </AppShell>
  )
}
