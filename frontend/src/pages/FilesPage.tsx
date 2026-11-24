import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FolderPlus, FolderX, LayoutGrid, List, Search, SearchX, Trash2, Upload, UploadCloud, X, FolderInput, Download } from 'lucide-react'
import { useFileManager } from '@hooks/useFileManager'
import { openDownload, subtreeIds, type FileRecord, type FolderNode } from '@services/files'
import { FILE_CATEGORIES, getErrorMessage } from '@lib/format'
import { cn } from '@lib/utils'
import { AppShell } from '@components/layout/AppShell'
import { Breadcrumb } from '@components/Breadcrumb'
import { FolderTree } from '@components/FolderTree'
import { Button } from '@components/ui/Button'
import { Input, Select } from '@components/ui/Input'
import { ConfirmDialog } from '@components/ui/Dialog'
import { EmptyState, ErrorState } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'
import { FileBrowser, FileBrowserSkeleton, type FileActions, type FolderActions } from '@components/files/FileBrowser'
import { MoveDialog, NameDialog } from '@components/files/FileDialogs'
import { UploadPanel } from '@components/files/UploadPanel'
import { ShareDialog, type ShareTarget } from '@components/ShareDialog'
import { ShareLinkDialog } from '@components/ShareLinkDialog'
import { DocumentInsightsDialog, type InsightsTarget } from '@components/ai/DocumentInsightsDialog'

type View = 'list' | 'grid'
const VIEW_KEY = 'nv:file-view'

const readView = (): View => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

type NameState = { mode: 'create-folder' } | { mode: 'rename-file'; file: FileRecord } | { mode: 'rename-folder'; folder: FolderNode }
type MoveState = { kind: 'files'; ids: string[]; from: string | null } | { kind: 'folder'; folder: FolderNode }
type DeleteState = { kind: 'files'; files: FileRecord[] } | { kind: 'folder'; folder: FolderNode }

export function FilesPage() {
  const { folderId } = useParams()
  const currentFolderId = folderId ?? null
  const fm = useFileManager(currentFolderId)
  const toast = useToast()

  const [view, setView] = useState<View>(readView)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [nameState, setNameState] = useState<NameState | null>(null)
  const [moveState, setMoveState] = useState<MoveState | null>(null)
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [linkFile, setLinkFile] = useState<FileRecord | null>(null)
  const [insights, setInsights] = useState<InsightsTarget | null>(null)
  const [dragging, setDragging] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const uploadRef = useRef(fm.upload)
  uploadRef.current = fm.upload

  const { setSearch } = fm
  useEffect(() => { setQuery(''); setSelected(new Set()) }, [currentFolderId])
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query, setSearch])
  // Drop selections that are no longer visible (after delete/move/page change).
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(fm.files.map((f) => f.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [fm.files])

  const changeView = (v: View) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
  }

  const folderNames = useMemo(() => new Map(fm.allFolders.map((f) => [f.id, f.name])), [fm.allFolders])
  const locationOf = useCallback((id: string | null) => (id ? folderNames.get(id) ?? 'Folder' : 'My Files'), [folderNames])

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAll = () => setSelected((prev) => (fm.files.every((f) => prev.has(f.id)) ? new Set() : new Set(fm.files.map((f) => f.id))))

  const onSort = (by: typeof fm.sort.by) =>
    fm.setSort((s) => (s.by === by ? { by, order: s.order === 'asc' ? 'desc' : 'asc' } : { by, order: by === 'filename' || by === 'category' ? 'asc' : 'desc' }))

  const download = async (file: FileRecord) => {
    try { await openDownload(file.id) } catch (err) { toast.error('Download failed', getErrorMessage(err, 'Please try again.')) }
  }

  const fileActions: FileActions = {
    download,
    rename: (file) => setNameState({ mode: 'rename-file', file }),
    move: (file) => setMoveState({ kind: 'files', ids: [file.id], from: file.folderId }),
    share: (file) => setShareTarget({ resourceType: 'FILE', resourceId: file.id, resourceName: file.filename, mimeType: file.mimeType, category: file.category }),
    shareLink: (file) => setLinkFile(file),
    remove: (file) => setDeleteState({ kind: 'files', files: [file] }),
    insights: (file) => setInsights({ id: file.id, filename: file.filename }),
  }
  const folderActions: FolderActions = {
    rename: (folder) => setNameState({ mode: 'rename-folder', folder }),
    move: (folder) => setMoveState({ kind: 'folder', folder }),
    share: (folder) => setShareTarget({ resourceType: 'FOLDER', resourceId: folder.id, resourceName: folder.name }),
    remove: (folder) => setDeleteState({ kind: 'folder', folder }),
  }

  const selectedFiles = fm.files.filter((f) => selected.has(f.id))

  const submitName = async (name: string) => {
    if (!nameState) return
    if (nameState.mode === 'create-folder') {
      await fm.createFolder(name)
      toast.success('Folder created', name)
    } else if (nameState.mode === 'rename-file') {
      await fm.renameFile(nameState.file, name)
      toast.success('File renamed', name)
    } else {
      await fm.renameFolder(nameState.folder.id, name)
      toast.success('Folder renamed', name)
    }
  }

  const submitMove = async (target: string | null) => {
    if (!moveState) return
    const dest = locationOf(target)
    if (moveState.kind === 'files') {
      await fm.moveFiles(moveState.ids, target)
      setSelected(new Set())
      toast.success(moveState.ids.length === 1 ? 'File moved' : `${moveState.ids.length} files moved`, `Now in ${dest}.`)
    } else {
      await fm.moveFolder(moveState.folder.id, target)
      toast.success('Folder moved', `“${moveState.folder.name}” is now in ${dest}.`)
    }
  }

  const confirmDelete = async () => {
    if (!deleteState) return
    setDeleting(true)
    try {
      if (deleteState.kind === 'files') {
        await fm.deleteFiles(deleteState.files.map((f) => f.id))
        setSelected(new Set())
        toast.success(deleteState.files.length === 1 ? 'File moved to trash' : `${deleteState.files.length} files moved to trash`)
      } else {
        await fm.deleteFolder(deleteState.folder.id)
        toast.success('Folder moved to trash', `“${deleteState.folder.name}” and its contents can be restored from Trash.`)
      }
      setDeleteState(null)
    } catch (err) {
      toast.error('Couldn’t delete', getErrorMessage(err, 'Please try again.'))
    } finally {
      setDeleting(false)
    }
  }

  // ---- Drag and drop upload anywhere on the page ----
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) }
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (e.dataTransfer?.files.length) uploadRef.current(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const title = fm.currentFolder?.name ?? (currentFolderId ? 'Folder' : 'My Files')
  const searching = fm.search.length > 0
  const nothingHere = !fm.isLoading && !fm.error && fm.files.length === 0 && fm.subfolders.length === 0
  const firstLoad = fm.isLoading && fm.files.length === 0
  const { page, limit, total, totalPages } = fm.pagination
  const target = fm.currentFolder ? `“${fm.currentFolder.name}”` : 'My Files'

  const moveDisabled = moveState?.kind === 'folder' ? subtreeIds(moveState.folder) : undefined
  const moveFrom = moveState?.kind === 'folder' ? moveState.folder.parentFolderId : moveState?.from ?? null

  return (
    <AppShell
      title={title}
      description={searching ? `Searching all folders for “${fm.search}”` : undefined}
      storage={fm.storage}
      actions={
        <>
          <Button variant="secondary" onClick={() => setNameState({ mode: 'create-folder' })} disabled={fm.folderMissing}>
            <FolderPlus className="h-4 w-4" /> New folder
          </Button>
          <Button onClick={() => uploadInput.current?.click()} disabled={fm.folderMissing}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => { if (e.target.files?.length) fm.upload(e.target.files); e.target.value = '' }}
          />
        </>
      }
      headerExtra={<div className="mb-5 -mt-2"><Breadcrumb path={fm.folderPath} /></div>}
    >
      {fm.folderMissing ? (
        <div className="border border-border bg-surface">
          <EmptyState
            icon={FolderX}
            title="This folder isn’t available"
            description="It may have been deleted or moved, or the link is incorrect."
            action={<Link to="/files" className="inline-flex h-9 items-center rounded bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">Go to My Files</Link>}
          />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden xl:block" aria-label="Folder tree">
            <div className="sticky top-6">
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Folders</p>
              <Link
                to="/files"
                className={cn('mb-px flex h-8 items-center gap-2 rounded px-2 text-sm', currentFolderId === null ? 'bg-primary/10 font-semibold text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground')}
                aria-current={currentFolderId === null ? 'page' : undefined}
              >
                My Files
              </Link>
              <FolderTree tree={fm.tree} currentFolderId={currentFolderId} activePath={fm.folderPath} />
            </div>
          </aside>

          <section aria-label="Folder contents" className="min-w-0">
            {/* Toolbar */}
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative md:max-w-sm md:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
                  placeholder="Search all files and folders"
                  aria-label="Search files and folders"
                  className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Clear search">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 md:ml-auto">
                <div className="w-[136px] shrink-0">
                  <Select aria-label="Filter by type" value={fm.category} onChange={(e) => fm.setCategory(e.target.value)}>
                    {FILE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </div>
                <div className="min-w-0 flex-1 md:w-[168px] md:flex-none">
                  <Select
                    aria-label="Sort files"
                    value={`${fm.sort.by}:${fm.sort.order}`}
                    onChange={(e) => { const [by, order] = e.target.value.split(':'); fm.setSort({ by: by as typeof fm.sort.by, order: order as 'asc' | 'desc' }) }}
                  >
                    <option value="uploadedAt:desc">Newest first</option>
                    <option value="uploadedAt:asc">Oldest first</option>
                    <option value="filename:asc">Name A–Z</option>
                    <option value="filename:desc">Name Z–A</option>
                    <option value="sizeBytes:desc">Largest first</option>
                    <option value="sizeBytes:asc">Smallest first</option>
                    <option value="category:asc">Type</option>
                  </Select>
                </div>
                <div className="flex shrink-0 rounded border border-border-strong p-0.5" role="group" aria-label="View">
                  {([['list', List], ['grid', LayoutGrid]] as const).map(([v, Icon]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => changeView(v)}
                      aria-pressed={view === v}
                      aria-label={v === 'list' ? 'List view' : 'Grid view'}
                      className={cn('grid h-7 w-8 place-items-center rounded-sm transition-colors', view === v ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bulk selection bar */}
            {selected.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 border border-primary/40 bg-primary/[0.07] px-3 py-2" role="region" aria-label="Selection actions">
                <span className="mr-auto text-sm font-semibold text-foreground" aria-live="polite">{selected.size} selected</span>
                {selected.size === 1 && (
                  <Button size="sm" variant="ghost" onClick={() => download(selectedFiles[0])}><Download className="h-4 w-4" /> Download</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setMoveState({ kind: 'files', ids: [...selected], from: selectedFiles[0]?.folderId ?? currentFolderId })}>
                  <FolderInput className="h-4 w-4" /> Move
                </Button>
                <Button size="sm" variant="ghost" className="text-[#ff7b70] hover:bg-danger/10 hover:text-[#ff7b70]" onClick={() => setDeleteState({ kind: 'files', files: selectedFiles })}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X className="h-4 w-4" /></Button>
              </div>
            )}

            {/* Content */}
            {fm.error && fm.files.length === 0 ? (
              <div className="border border-border bg-surface"><ErrorState title="Couldn’t load this folder" message={fm.error} onRetry={fm.refresh} /></div>
            ) : firstLoad ? (
              <FileBrowserSkeleton view={view} />
            ) : nothingHere ? (
              <div className="border border-dashed border-border-strong bg-surface">
                {searching || fm.category ? (
                  <EmptyState
                    icon={SearchX}
                    title={searching ? `No results for “${fm.search}”` : 'No files of this type here'}
                    description={searching ? 'Try a different name, or check the spelling.' : 'Choose “All types” to see everything in this folder.'}
                    action={<Button variant="secondary" onClick={() => { setQuery(''); fm.setCategory('') }}>Clear filters</Button>}
                  />
                ) : (
                  <EmptyState
                    icon={UploadCloud}
                    title={currentFolderId ? 'This folder is empty' : 'Your vault is ready'}
                    description={<>Drag files anywhere on this page, or use Upload. Files up to 100 MB each.</>}
                    action={
                      <>
                        <Button onClick={() => uploadInput.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>
                        <Button variant="secondary" onClick={() => setNameState({ mode: 'create-folder' })}><FolderPlus className="h-4 w-4" /> New folder</Button>
                      </>
                    }
                  />
                )}
              </div>
            ) : (
              <div className={cn('transition-opacity', fm.isLoading && 'pointer-events-none opacity-60')} aria-busy={fm.isLoading}>
                <FileBrowser
                  view={view}
                  folders={fm.subfolders}
                  files={fm.files}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                  sort={fm.sort}
                  onSort={onSort}
                  fileActions={fileActions}
                  folderActions={folderActions}
                  locationOf={searching ? locationOf : undefined}
                />
                {totalPages > 1 && (
                  <nav className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
                    <p className="text-sm text-muted-foreground">
                      Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} files
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => fm.fetchFiles(page - 1)}>Previous</Button>
                      <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => fm.fetchFiles(page + 1)}>Next</Button>
                    </div>
                  </nav>
                )}
                {fm.error && <p role="alert" className="mt-3 text-sm text-[#ff7b70]">{fm.error}</p>}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/70 p-6 lg:pl-[248px]" aria-hidden="true">
          <div className="flex flex-col items-center border-2 border-dashed border-primary bg-surface/95 px-12 py-10 text-center shadow-brand">
            <UploadCloud className="h-9 w-9 text-primary" />
            <p className="mt-3 text-md font-semibold text-foreground">Drop to upload to {target}</p>
            <p className="mt-1 text-sm text-muted-foreground">Up to 100 MB per file</p>
          </div>
        </div>
      )}

      <UploadPanel uploads={fm.uploads} onClear={fm.clearFinishedUploads} />

      <NameDialog
        open={!!nameState}
        mode={nameState?.mode ?? 'create-folder'}
        initialValue={nameState?.mode === 'rename-file' ? nameState.file.filename : nameState?.mode === 'rename-folder' ? nameState.folder.name : ''}
        onClose={() => setNameState(null)}
        onSubmit={submitName}
      />
      <MoveDialog
        open={!!moveState}
        title={moveState?.kind === 'folder' ? `Move “${moveState.folder.name}”` : moveState && moveState.ids.length > 1 ? `Move ${moveState.ids.length} files` : 'Move file'}
        tree={fm.tree}
        currentParentId={moveFrom}
        disabledIds={moveDisabled}
        onClose={() => setMoveState(null)}
        onSubmit={submitMove}
      />
      <ConfirmDialog
        open={!!deleteState}
        loading={deleting}
        title={deleteState?.kind === 'folder' ? 'Delete folder?' : deleteState && deleteState.files.length > 1 ? `Delete ${deleteState.files.length} files?` : 'Delete file?'}
        confirmLabel="Delete"
        description={
          deleteState?.kind === 'folder' ? (
            <>“<strong className="text-foreground">{deleteState.folder.name}</strong>” and <strong className="text-foreground">everything inside it</strong> — subfolders and files — will move to trash. People it was shared with lose access until you restore it.</>
          ) : deleteState?.files.length === 1 ? (
            <>“<strong className="text-foreground">{deleteState.files[0].filename}</strong>” will move to trash, and its share links will stop working until you restore it.</>
          ) : (
            <>The {deleteState?.files.length} selected files will move to trash, and their share links will stop working until you restore them.</>
          )
        }
        onCancel={() => setDeleteState(null)}
        onConfirm={confirmDelete}
      />
      <ShareDialog open={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
      <ShareLinkDialog open={!!linkFile} file={linkFile} onClose={() => setLinkFile(null)} />
      <DocumentInsightsDialog target={insights} onClose={() => setInsights(null)} onStatusChange={() => fm.fetchFiles(fm.pagination.page)} />
    </AppShell>
  )
}
