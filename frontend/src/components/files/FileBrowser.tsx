import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react'
import type { FileRecord, FolderNode } from '@services/files'
import type { SortState } from '@hooks/useFileManager'
import { formatDate, formatFileSize, formatRelative, getFileTypeMeta } from '@lib/format'
import { cn } from '@lib/utils'
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu'
import { FileTypeIcon, FolderIcon } from './FileTypeIcon'
import { folderHref } from '../Breadcrumb'
import { AiStatusBadge } from '../ai/AiStatusBadge'
import { AI_SUPPORTED_MIME } from '@services/ai'

export interface FileActions {
  download: (file: FileRecord) => void
  rename: (file: FileRecord) => void
  move: (file: FileRecord) => void
  share: (file: FileRecord) => void
  shareLink: (file: FileRecord) => void
  remove: (file: FileRecord) => void
  /** Opens AI document insights (status, summary, extracted text). */
  insights?: (file: FileRecord) => void
}

export interface FolderActions {
  rename: (folder: FolderNode) => void
  move: (folder: FolderNode) => void
  share: (folder: FolderNode) => void
  remove: (folder: FolderNode) => void
}

interface FileBrowserProps {
  view: 'list' | 'grid'
  folders: FolderNode[]
  files: FileRecord[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  sort: SortState
  onSort: (by: SortState['by']) => void
  fileActions: FileActions
  folderActions: FolderActions
  /** id → folder name, used to show each file's location in search results. */
  locationOf?: (folderId: string | null) => string
}

const fileMenu = (file: FileRecord, a: FileActions): MenuItem[] => [
  { label: 'Download', icon: Download, onSelect: () => a.download(file) },
  ...(a.insights && AI_SUPPORTED_MIME.includes(file.mimeType)
    ? [{ label: 'Document insights', icon: Sparkles, onSelect: () => a.insights!(file) }]
    : []),
  { label: 'Share with people', icon: UserPlus, onSelect: () => a.share(file), separated: true },
  { label: 'Create share link', icon: Link2, onSelect: () => a.shareLink(file) },
  { label: 'Rename', icon: Pencil, onSelect: () => a.rename(file), separated: true },
  { label: 'Move to…', icon: FolderInput, onSelect: () => a.move(file) },
  { label: 'Delete', icon: Trash2, onSelect: () => a.remove(file), tone: 'danger', separated: true },
]

const folderMenu = (folder: FolderNode, a: FolderActions): MenuItem[] => [
  { label: 'Share with people', icon: UserPlus, onSelect: () => a.share(folder) },
  { label: 'Rename', icon: Pencil, onSelect: () => a.rename(folder), separated: true },
  { label: 'Move to…', icon: FolderInput, onSelect: () => a.move(folder) },
  { label: 'Delete', icon: Trash2, onSelect: () => a.remove(folder), tone: 'danger', separated: true },
]

function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  return (
    <DropdownMenu
      label={label}
      items={items}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={label}
          className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground aria-expanded:bg-white/[0.08] aria-expanded:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    />
  )
}

function Checkbox({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: () => void; label: string; indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!indeterminate }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="nv-checkbox"
    />
  )
}

function SortHeader({ label, field, sort, onSort, className }: { label: string; field: SortState['by']; sort: SortState; onSort: (f: SortState['by']) => void; className?: string }) {
  const active = sort.by === field
  return (
    <th scope="col" aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-3 text-left font-semibold', className)}>
      <button type="button" onClick={() => onSort(field)} className={cn('inline-flex items-center gap-1 rounded py-1 transition-colors hover:text-foreground', active && 'text-foreground')}>
        {label}
        {active && (sort.order === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
      </button>
    </th>
  )
}

export function FileBrowser(props: FileBrowserProps) {
  return props.view === 'grid' ? <GridView {...props} /> : <ListView {...props} />
}

function ListView({ folders, files, selected, onToggle, onToggleAll, sort, onSort, fileActions, folderActions, locationOf }: FileBrowserProps) {
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id))
  const someSelected = !allSelected && files.some((f) => selected.has(f.id))
  return (
    <div className="overflow-hidden border border-border bg-surface">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="border-b border-border bg-surface-sunken text-xs text-muted-foreground">
          <tr className="h-10">
            <th scope="col" className="w-11 pl-4">
              {files.length > 0 && <Checkbox checked={allSelected} indeterminate={someSelected} onChange={onToggleAll} label={allSelected ? 'Deselect all files' : 'Select all files'} />}
            </th>
            <SortHeader label="Name" field="filename" sort={sort} onSort={onSort} />
            <SortHeader label="Type" field="category" sort={sort} onSort={onSort} className="hidden w-[130px] xl:table-cell" />
            <SortHeader label="Size" field="sizeBytes" sort={sort} onSort={onSort} className="hidden w-[100px] md:table-cell" />
            <SortHeader label="Uploaded" field="uploadedAt" sort={sort} onSort={onSort} className="hidden w-[140px] lg:table-cell" />
            <th scope="col" className="w-14 pr-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {folders.map((folder) => (
            <tr key={folder.id} className="group h-14 transition-colors hover:bg-white/[0.025]">
              <td className="pl-4" />
              <td className="px-3">
                <Link to={folderHref(folder.id)} className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-offset-4">
                  <FolderIcon />
                  <span className="truncate font-medium text-foreground group-hover:text-primary">{folder.name}</span>
                </Link>
              </td>
              <td className="hidden px-3 text-muted-foreground xl:table-cell">Folder</td>
              <td className="hidden px-3 text-subtle md:table-cell">—</td>
              <td className="hidden px-3 text-muted-foreground lg:table-cell">{formatDate(folder.createdAt)}</td>
              <td className="pr-3 text-right"><RowMenu label={`Actions for folder ${folder.name}`} items={folderMenu(folder, folderActions)} /></td>
            </tr>
          ))}
          {files.map((file) => {
            const isSelected = selected.has(file.id)
            const meta = getFileTypeMeta(file.filename, file.mimeType, file.category)
            return (
              <tr
                key={file.id}
                onClick={() => onToggle(file.id)}
                aria-selected={isSelected}
                className={cn('group h-14 cursor-pointer transition-colors', isSelected ? 'bg-primary/[0.07] hover:bg-primary/10' : 'hover:bg-white/[0.025]')}
              >
                <td className="pl-4"><Checkbox checked={isSelected} onChange={() => onToggle(file.id)} label={`Select ${file.filename}`} /></td>
                <td className="px-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileTypeIcon filename={file.filename} mimeType={file.mimeType} category={file.category} />
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-foreground" title={file.filename}>{file.filename}</span>
                        <AiStatusBadge status={file.aiStatus} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground lg:hidden">
                        {formatFileSize(file.sizeBytes)} · {formatRelative(file.uploadedAt)}
                        {locationOf && <> · {locationOf(file.folderId)}</>}
                      </p>
                      {locationOf && <p className="hidden truncate text-xs text-subtle lg:block">in {locationOf(file.folderId)}</p>}
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 text-muted-foreground xl:table-cell">{meta.label}</td>
                <td className="hidden px-3 tabular-nums text-muted-foreground md:table-cell">{formatFileSize(file.sizeBytes)}</td>
                <td className="hidden px-3 text-muted-foreground lg:table-cell" title={new Date(file.uploadedAt).toLocaleString()}>{formatRelative(file.uploadedAt)}</td>
                <td className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <RowMenu label={`Actions for ${file.filename}`} items={fileMenu(file, fileActions)} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GridView({ folders, files, selected, onToggle, fileActions, folderActions, locationOf }: FileBrowserProps) {
  return (
    <div className="space-y-6">
      {folders.length > 0 && (
        <section aria-label="Folders">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Folders</h2>
          <ul className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {folders.map((folder) => (
              <li key={folder.id} className="group relative flex h-14 items-center gap-3 border border-border bg-surface pl-3 pr-1.5 transition-colors hover:border-border-strong hover:bg-white/[0.025]">
                <FolderIcon />
                <Link to={folderHref(folder.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground after:absolute after:inset-0 group-hover:text-primary">
                  {folder.name}
                </Link>
                <div className="relative z-10"><RowMenu label={`Actions for folder ${folder.name}`} items={folderMenu(folder, folderActions)} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length > 0 && (
        <section aria-label="Files">
          {folders.length > 0 && <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Files</h2>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {files.map((file) => {
              const isSelected = selected.has(file.id)
              return (
                <li
                  key={file.id}
                  onClick={() => onToggle(file.id)}
                  className={cn(
                    'group relative flex cursor-pointer flex-col border bg-surface transition-colors',
                    isSelected ? 'border-primary/60 bg-primary/[0.06]' : 'border-border hover:border-border-strong hover:bg-white/[0.025]'
                  )}
                >
                  <div className="relative grid h-28 place-items-center border-b border-border bg-surface-sunken">
                    <FileTypeIcon filename={file.filename} mimeType={file.mimeType} category={file.category} size="lg" />
                    <div className={cn('absolute left-2 top-2 transition-opacity', isSelected ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}>
                      <Checkbox checked={isSelected} onChange={() => onToggle(file.id)} label={`Select ${file.filename}`} />
                    </div>
                    <div className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
                      <RowMenu label={`Actions for ${file.filename}`} items={fileMenu(file, fileActions)} />
                    </div>
                  </div>
                  <div className="min-w-0 p-3">
                    <p className="truncate text-sm font-medium text-foreground" title={file.filename}>{file.filename}</p>
                    <div className="mt-1"><AiStatusBadge status={file.aiStatus} /></div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {formatFileSize(file.sizeBytes)} · {locationOf ? locationOf(file.folderId) : formatRelative(file.uploadedAt)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

export function FileBrowserSkeleton({ view }: { view: 'list' | 'grid' }) {
  if (view === 'grid') {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Loading files" aria-busy="true">
        {Array.from({ length: 10 }).map((_, i) => (
          <li key={i} className="border border-border bg-surface"><div className="skeleton h-28" /><div className="space-y-2 p-3"><div className="skeleton h-3 w-3/4 rounded" /><div className="skeleton h-3 w-1/2 rounded" /></div></li>
        ))}
      </ul>
    )
  }
  return (
    <div className="border border-border bg-surface" aria-label="Loading files" aria-busy="true">
      <div className="h-10 border-b border-border bg-surface-sunken" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 border-b border-border px-4 last:border-0">
          <div className="skeleton h-4 w-4 rounded-sm" />
          <div className="skeleton h-7 w-7 rounded" />
          <div className="skeleton h-3 rounded" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
          <div className="skeleton ml-auto hidden h-3 w-16 rounded md:block" />
          <div className="skeleton hidden h-3 w-20 rounded lg:block" />
        </div>
      ))}
    </div>
  )
}
