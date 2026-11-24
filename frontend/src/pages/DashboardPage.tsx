import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, Download, FileText, FolderClosed, FolderPlus, HardDrive, Upload, UserPlus, Users } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { useFileManager } from '@hooks/useFileManager'
import { filesApi, openDownload, type FileRecord } from '@services/files'
import { sharingApi } from '@services/sharing'
import { activityApi, type ActivityLogEntry } from '@services/activity'
import { formatFileSize, formatRelative, getErrorMessage } from '@lib/format'
import { cn } from '@lib/utils'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { EmptyState, ErrorState, Panel, Skeleton } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'
import { FileTypeIcon } from '@components/files/FileTypeIcon'
import { NameDialog } from '@components/files/FileDialogs'
import { UploadPanel } from '@components/files/UploadPanel'
import { ActivityItem, type NameResolver } from '@components/activity/ActivityItem'
import { ShareDialog, type ShareTarget } from '@components/ShareDialog'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Stat({ label, value, icon: Icon, to, loading }: { label: string; value: string | number; icon: typeof FileText; to: string; loading: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-4 border border-border bg-surface p-4 shadow-e1 transition-colors hover:border-border-strong hover:bg-white/[0.02]">
      <span className="grid h-10 w-10 place-items-center bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        {loading ? <Skeleton className="mt-1.5 h-6 w-12" /> : <span className="app-title block text-2xl font-bold tabular-nums text-foreground">{value}</span>}
      </span>
      <ArrowRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
    </Link>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const toast = useToast()
  // Root-level manager powers quick upload / new folder, the folder count, and storage.
  const fm = useFileManager(null)
  const [recent, setRecent] = useState<FileRecord[]>([])
  const [fileTotal, setFileTotal] = useState(0)
  const [recentState, setRecentState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sharedCount, setSharedCount] = useState<number | null>(null)
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [activityState, setActivityState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)

  const loadRecent = useCallback(async () => {
    setRecentState('loading')
    try {
      const data = await filesApi.list({ limit: 6, sortBy: 'uploadedAt', sortOrder: 'desc' })
      setRecent(data.files)
      setFileTotal(data.pagination.total)
      setRecentState('ready')
    } catch {
      setRecentState('error')
    }
  }, [])

  const loadActivity = useCallback(async () => {
    setActivityState('loading')
    try {
      const res = await activityApi.getActivityLog({ page: 1, limit: 6 })
      setActivity(res.data?.entries ?? [])
      setActivityState('ready')
    } catch {
      setActivityState('error')
    }
  }, [])

  useEffect(() => {
    loadRecent()
    loadActivity()
    sharingApi.getSharedWithMe(1, 1)
      .then((r) => setSharedCount(r.data?.pagination.total ?? 0))
      .catch(() => setSharedCount(null))
  }, [loadRecent, loadActivity])

  // Refresh recent files once a batch of uploads finishes.
  const activeUploads = fm.uploads.some((u) => u.status === 'uploading' || u.status === 'queued')
  const prevActive = useRef(false)
  useEffect(() => {
    if (prevActive.current && !activeUploads) { loadRecent(); loadActivity() }
    prevActive.current = activeUploads
  }, [activeUploads, loadRecent, loadActivity])

  const folderNames = useMemo(() => new Map(fm.allFolders.map((f) => [f.id, f.name])), [fm.allFolders])
  const resolve: NameResolver = useCallback(
    (type, id) => (id ? (type === 'FOLDER' ? folderNames.get(id) : recent.find((f) => f.id === id)?.filename) : undefined),
    [folderNames, recent]
  )

  const quota = Number(fm.storage?.quota ?? 0)
  const used = Number(fm.storage?.used ?? 0)
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0
  const firstName = user?.name?.split(' ')[0] ?? ''

  return (
    <AppShell
      title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
      description="Here’s what’s happening in your vault."
      storage={fm.storage}
      actions={
        <>
          <Button variant="secondary" onClick={() => setNewFolderOpen(true)}><FolderPlus className="h-4 w-4" /> New folder</Button>
          <Button onClick={() => uploadInput.current?.click()}><Upload className="h-4 w-4" /> Upload</Button>
          <input ref={uploadInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { if (e.target.files?.length) fm.upload(e.target.files); e.target.value = '' }} />
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Files" value={fileTotal} icon={FileText} to="/files" loading={recentState === 'loading'} />
        <Stat label="Folders" value={fm.allFolders.length} icon={FolderClosed} to="/files" loading={!fm.treeLoaded} />
        <Stat label="Shared with you" value={sharedCount ?? '—'} icon={Users} to="/shared-with-me" loading={sharedCount === null && recentState === 'loading'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Recent files"
            action={<Link to="/files" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover">View all <ArrowRight className="h-3.5 w-3.5" /></Link>}
          >
            {recentState === 'loading' ? (
              <ul className="divide-y divide-border">{Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5"><Skeleton className="h-7 w-7" /><Skeleton className="h-3 flex-1 max-w-[260px]" /><Skeleton className="ml-auto h-3 w-16" /></li>
              ))}</ul>
            ) : recentState === 'error' ? (
              <ErrorState title="Couldn’t load recent files" onRetry={loadRecent} className="py-10" />
            ) : recent.length === 0 ? (
              <EmptyState
                compact
                icon={Upload}
                title="No files yet"
                description="Upload your first file to see it here."
                action={<Button size="sm" onClick={() => uploadInput.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>}
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((file) => (
                  <li key={file.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.02] sm:px-5">
                    <FileTypeIcon filename={file.filename} mimeType={file.mimeType} category={file.category} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground" title={file.filename}>{file.filename}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatFileSize(file.sizeBytes)} · {file.folderId ? (
                          <Link to={`/files/${file.folderId}`} className="hover:text-foreground hover:underline">{folderNames.get(file.folderId) ?? 'Folder'}</Link>
                        ) : (
                          <Link to="/files" className="hover:text-foreground hover:underline">My Files</Link>
                        )} · {formatRelative(file.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button size="icon-sm" variant="ghost" aria-label={`Share ${file.filename}`}
                        onClick={() => setShareTarget({ resourceType: 'FILE', resourceId: file.id, resourceName: file.filename, mimeType: file.mimeType, category: file.category })}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Download ${file.filename}`}
                        onClick={() => openDownload(file.id).catch((err) => toast.error('Download failed', getErrorMessage(err, 'Please try again.')))}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { to: '/shared-with-me', icon: Users, title: 'Shared with me', body: 'Files and folders other people gave you access to.' },
              { to: '/activity', icon: Activity, title: 'Activity history', body: 'Downloads, renames, moves, deletions, and sharing changes.' },
            ].map((card) => (
              <Link key={card.to} to={card.to} className="group flex gap-3 border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-white/[0.02]">
                <card.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-foreground">{card.title} <ArrowRight className="h-3.5 w-3.5 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{card.body}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <Panel title="Storage" bodyClassName="p-4 sm:p-5">
            {fm.storage ? (
              <>
                <div className="flex items-end justify-between">
                  <p><span className="app-title text-3xl font-bold tabular-nums text-foreground">{formatFileSize(used)}</span> <span className="text-sm text-muted-foreground">of {formatFileSize(quota)}</span></p>
                  <HardDrive className="h-5 w-5 text-subtle" aria-hidden="true" />
                </div>
                <div className="mt-3 h-2 overflow-hidden bg-white/[0.08]" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                  <div className={cn('h-full', pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatFileSize(fm.storage.remaining)} available{pct >= 90 && <span className="text-[#ff7b70]"> · Almost full — delete files to free space</span>}
                </p>
              </>
            ) : (
              <div className="space-y-3"><Skeleton className="h-8 w-32" /><Skeleton className="h-2 w-full" /><Skeleton className="h-3 w-24" /></div>
            )}
          </Panel>

          <Panel
            title="Recent activity"
            action={<Link to="/activity" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover">View all <ArrowRight className="h-3.5 w-3.5" /></Link>}
            bodyClassName="px-4 sm:px-5"
          >
            {activityState === 'loading' ? (
              <div className="space-y-4 py-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
            ) : activityState === 'error' ? (
              <ErrorState title="Couldn’t load activity" onRetry={loadActivity} className="py-10" />
            ) : activity.length === 0 ? (
              <EmptyState compact icon={Activity} title="No activity yet" description="Downloads, sharing, and file changes will appear here." />
            ) : (
              <ul className="divide-y divide-border">{activity.map((e) => <ActivityItem key={e.id} entry={e} resolve={resolve} compact />)}</ul>
            )}
          </Panel>
        </div>
      </div>

      <UploadPanel uploads={fm.uploads} onClear={fm.clearFinishedUploads} />
      <NameDialog
        open={newFolderOpen}
        mode="create-folder"
        onClose={() => setNewFolderOpen(false)}
        onSubmit={async (name) => { await fm.createFolder(name, null); toast.success('Folder created', `“${name}” is in My Files.`) }}
      />
      <ShareDialog open={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
    </AppShell>
  )
}
