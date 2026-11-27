import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, Download, FolderX, Link2, MoreHorizontal, Pencil, Sparkles, Upload } from 'lucide-react'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { EmptyState, ErrorState, RoleBadge, Skeleton } from '@components/ui/primitives'
import { DropdownMenu, type MenuItem } from '@components/ui/DropdownMenu'
import { useToast } from '@components/ui/Toast'
import { FileTypeIcon, FolderIcon } from '@components/files/FileTypeIcon'
import { ShareLinkDialog } from '@components/ShareLinkDialog'
import { AiStatusBadge } from '@components/ai/AiStatusBadge'
import { DocumentInsightsDialog, type InsightsTarget } from '@components/ai/DocumentInsightsDialog'
import { NameDialog } from '@components/files/FileDialogs'
import { UploadPanel } from '@components/files/UploadPanel'
import type { UploadItem } from '@hooks/useFileManager'
import { filesApi, foldersApi, MAX_UPLOAD_BYTES, openDownload, type FileRecord, type FolderContents } from '@services/files'
import { AI_SUPPORTED_MIME } from '@services/ai'
import { formatFileSize, formatRelative, getErrorMessage } from '@lib/format'

/** Browse a folder someone shared with you, including all of its subfolders. */
export function SharedFolderPage() {
  const { folderId } = useParams()
  const toast = useToast()
  const [data, setData] = useState<FolderContents | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [linkFile, setLinkFile] = useState<FileRecord | null>(null)
  const [insights, setInsights] = useState<InsightsTarget | null>(null)
  const [renaming, setRenaming] = useState<FileRecord | null>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!folderId) return
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      setData(await foldersApi.contents(folderId))
      setState('ready')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404 || status === 400) setState('missing')
      else { setError(getErrorMessage(err, 'Couldn’t load this folder.')); setState('error') }
    }
  }, [folderId])

  useEffect(() => { setData(null); setState('loading'); load() }, [load])

  const canEdit = data?.permission === 'EDITOR' || data?.permission === 'OWNER'

  /** Files an Editor adds belong to the folder's owner and use the owner's storage. */
  const upload = async (list: FileList) => {
    if (!folderId) return
    const picked = Array.from(list)
    const items: UploadItem[] = picked.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      size: f.size,
      progress: 0,
      ...(f.size > MAX_UPLOAD_BYTES ? { status: 'error' as const, error: 'Larger than the 100 MB limit' } : { status: 'queued' as const }),
    }))
    setUploads((prev) => [...prev.filter((u) => u.status === 'uploading' || u.status === 'queued'), ...items])
    for (const [i, item] of items.entries()) {
      if (item.status === 'error') continue
      const patch = (p: Partial<UploadItem>) => setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, ...p } : u)))
      patch({ status: 'uploading' })
      try {
        await filesApi.upload(picked[i], folderId, (progress) => patch({ progress }))
        patch({ status: 'done', progress: 100 })
      } catch (err) {
        patch({ status: 'error', error: getErrorMessage(err, 'Upload failed') })
      }
    }
    await load()
  }

  const download = async (f: FileRecord) => {
    try { await openDownload(f.id) } catch (err) { toast.error('Download failed', getErrorMessage(err, 'Please try again.')) }
  }

  const menu = (f: FileRecord): MenuItem[] => [
    { label: 'Download', icon: Download, onSelect: () => download(f) },
    ...(AI_SUPPORTED_MIME.includes(f.mimeType) ? [{ label: 'Document insights', icon: Sparkles, onSelect: () => setInsights({ id: f.id, filename: f.filename }) }] : []),
    ...(canEdit ? [
      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(f), separated: true },
      { label: 'Create share link', icon: Link2, onSelect: () => setLinkFile(f) },
    ] : []),
  ]

  const title = data?.folder?.name ?? 'Shared folder'

  return (
    <AppShell
      title={title}
      description={data ? <span className="inline-flex items-center gap-2">Your role <RoleBadge role={data.permission} /></span> : undefined}
      actions={canEdit ? (
        <>
          <Button onClick={() => uploadInput.current?.click()}><Upload className="h-4 w-4" /> Upload</Button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }}
          />
        </>
      ) : undefined}
      headerExtra={
        <nav aria-label="Breadcrumb" className="-mt-2 mb-5">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <li><Link to="/shared-with-me" className="hover:text-foreground">Shared with me</Link></li>
            {data?.path.map((p, i) => (
              <li key={p.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />
                {i === data.path.length - 1
                  ? <span aria-current="page" className="font-semibold text-foreground">{p.name}</span>
                  : <Link to={`/shared-with-me/folders/${p.id}`} className="hover:text-foreground">{p.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
      }
    >
      {state === 'missing' ? (
        <div className="border border-border bg-surface">
          <EmptyState icon={FolderX} title="This folder isn’t available" description="It may have been deleted, or your access was removed." action={<Link to="/shared-with-me" className="inline-flex h-9 items-center rounded bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">Back to Shared with me</Link>} />
        </div>
      ) : state === 'error' ? (
        <div className="border border-border bg-surface"><ErrorState title="Couldn’t load this folder" message={error} onRetry={load} /></div>
      ) : state === 'loading' || !data ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading folder">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : data.folders.length === 0 && data.files.length === 0 ? (
        <div className="border border-dashed border-border-strong bg-surface"><EmptyState icon={FolderX} title="This folder is empty" /></div>
      ) : (
        <ul className="divide-y divide-border border border-border bg-surface">
          {data.folders.map((f) => (
            <li key={f.id}>
              <Link to={`/shared-with-me/folders/${f.id}`} className="group flex h-14 items-center gap-3 px-4 hover:bg-white/[0.025]">
                <FolderIcon />
                <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">{f.name}</span>
                <ChevronRight className="ml-auto h-4 w-4 text-subtle" aria-hidden="true" />
              </Link>
            </li>
          ))}
          {data.files.map((f) => (
            <li key={f.id} className="flex h-16 items-center gap-3 px-4">
              <FileTypeIcon filename={f.filename} mimeType={f.mimeType} category={f.category} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium text-foreground" title={f.filename}>{f.filename}</span><AiStatusBadge status={f.aiStatus} /></p>
                <p className="truncate text-xs text-muted-foreground">{formatFileSize(f.sizeBytes)} · {formatRelative(f.uploadedAt)}</p>
              </div>
              <DropdownMenu
                label={`Actions for ${f.filename}`}
                items={menu(f)}
                trigger={(props) => (
                  <Button {...props} size="icon-sm" variant="ghost" aria-label={`Actions for ${f.filename}`}><MoreHorizontal className="h-4 w-4" /></Button>
                )}
              />
            </li>
          ))}
        </ul>
      )}
      <UploadPanel uploads={uploads} onClear={() => setUploads((prev) => prev.filter((u) => u.status === 'uploading' || u.status === 'queued'))} />
      <NameDialog
        open={!!renaming}
        mode="rename-file"
        initialValue={renaming?.filename ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return
          await filesApi.rename(renaming.id, name)
          toast.success('File renamed', name)
          await load()
        }}
      />
      <ShareLinkDialog open={!!linkFile} file={linkFile} onClose={() => setLinkFile(null)} />
      <DocumentInsightsDialog target={insights} onClose={() => setInsights(null)} onStatusChange={load} />
    </AppShell>
  )
}
