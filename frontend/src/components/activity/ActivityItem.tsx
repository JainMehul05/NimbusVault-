import type { ReactNode } from 'react'
import {
  Download,
  FolderInput,
  FolderPlus,
  FolderX,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
  UserCog,
  UserMinus,
  UserPlus,
  Eye,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityLogEntry } from '@services/activity'
import { formatDateTime, formatRelative, formatTime } from '@lib/format'
import { cn } from '@lib/utils'

/** Resolves a resource id to a display name when the page knows it. */
export type NameResolver = (type: 'FILE' | 'FOLDER', id: string | null | undefined) => string | undefined

interface Described {
  icon: LucideIcon
  tone: string
  text: ReactNode
  category: string
}

const Name = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>

const roleWord = (level: unknown) => (level === 'EDITOR' ? 'Editor' : level === 'VIEWER' ? 'Viewer' : 'shared')

export function describeActivity(entry: ActivityLogEntry, resolve?: NameResolver): Described {
  const m = (entry.metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v && v !== 'unknown' ? v : undefined)
  const kind = entry.resourceType === 'FOLDER' ? 'folder' : 'file'
  const resourceName =
    str(m.filename) ??
    str(m.name) ??
    (entry.resourceType === 'FILE' || entry.resourceType === 'FOLDER' ? resolve?.(entry.resourceType, entry.resourceId) : undefined)
  const target = resourceName ? <Name>{resourceName}</Name> : <>a {kind}</>

  switch (entry.action) {
    case 'file_upload':
      return { icon: Upload, tone: 'text-info bg-info/10', category: 'File', text: <>Uploaded {target}</> }
    case 'file_download':
      return {
        icon: Download, tone: 'text-success bg-success/10', category: m.viaShareLink ? 'Share link' : 'File',
        text: <>Downloaded {target}{m.viaShareLink ? ' via a share link' : ''}</>,
      }
    case 'file_rename': {
      const oldName = str(m.oldName)
      const newName = str(m.newName)
      return {
        icon: Pencil, tone: 'text-warning bg-warning/10', category: 'File',
        text: oldName && newName ? <>Renamed <Name>{oldName}</Name> to <Name>{newName}</Name></> : newName ? <>Renamed a file to <Name>{newName}</Name></> : <>Renamed {target}</>,
      }
    }
    case 'file_move': {
      const dest = m.newFolderId ? resolve?.('FOLDER', m.newFolderId as string) : 'My Files'
      return {
        icon: FolderInput, tone: 'text-[#c4a7ff] bg-[#c4a7ff]/10', category: 'File',
        text: <>Moved {target}{dest ? <> to <Name>{dest}</Name></> : ' to another folder'}</>,
      }
    }
    case 'file_delete':
      return { icon: Trash2, tone: 'text-danger bg-danger/10', category: 'File', text: <>Deleted {target}</> }
    case 'file_restore':
      return { icon: RotateCcw, tone: 'text-success bg-success/10', category: 'File', text: <>Restored {target}</> }
    case 'folder_create':
      return { icon: FolderPlus, tone: 'text-primary bg-primary/10', category: 'Folder', text: <>Created folder {target}</> }
    case 'folder_rename': {
      const oldName = str(m.oldName)
      const newName = str(m.newName)
      return {
        icon: Pencil, tone: 'text-warning bg-warning/10', category: 'Folder',
        text: oldName && newName ? <>Renamed folder <Name>{oldName}</Name> to <Name>{newName}</Name></> : <>Renamed folder {target}</>,
      }
    }
    case 'folder_move': {
      const dest = m.newParentId ? resolve?.('FOLDER', m.newParentId as string) : 'My Files'
      return {
        icon: FolderInput, tone: 'text-[#c4a7ff] bg-[#c4a7ff]/10', category: 'Folder',
        text: <>Moved folder {target}{dest ? <> to <Name>{dest}</Name></> : ' to another folder'}</>,
      }
    }
    case 'share_update':
      return {
        icon: UserCog, tone: 'text-info bg-info/10', category: 'Sharing',
        text: m.previousLevel
          ? <>Changed someone’s access to {target} from {roleWord(m.previousLevel)} to <Name>{roleWord(m.level)}</Name></>
          : <>Updated someone’s access to {target} to <Name>{roleWord(m.level)}</Name></>,
      }
    case 'share_link_create': {
      const fileName = str(m.filename) ?? resolve?.('FILE', m.fileId as string)
      return {
        icon: Link2, tone: 'text-primary bg-primary/10', category: 'Share link',
        text: <>Created a {m.permission === 'DOWNLOAD' ? 'download' : 'view-only'} share link{fileName ? <> for <Name>{fileName}</Name></> : ''}</>,
      }
    }
    case 'share_link_revoke': {
      const fileName = str(m.filename) ?? resolve?.('FILE', m.fileId as string)
      return { icon: KeyRound, tone: 'text-[#ff7b70] bg-danger/10', category: 'Share link', text: <>Revoked a share link{fileName ? <> for <Name>{fileName}</Name></> : ''}</> }
    }
    case 'ai_query':
      return { icon: Sparkles, tone: 'text-primary bg-primary/10', category: 'AI', text: <>Asked NimbusVault a question</> }
    case 'ai_reindex':
      return { icon: Sparkles, tone: 'text-primary bg-primary/10', category: 'AI', text: <>Re-indexed {target} for AI</> }
    case 'folder_delete':
      return { icon: FolderX, tone: 'text-danger bg-danger/10', category: 'Folder', text: <>Deleted folder {target}</> }
    case 'share_create': {
      if (entry.resourceType === 'SHARE_LINK') {
        const fileName = resolve?.('FILE', m.fileId as string)
        return {
          icon: Link2, tone: 'text-primary bg-primary/10', category: 'Share link',
          text: <>Created a {m.permission === 'DOWNLOAD' ? 'download' : 'view-only'} share link{fileName ? <> for <Name>{fileName}</Name></> : ''}</>,
        }
      }
      return { icon: UserPlus, tone: 'text-primary bg-primary/10', category: 'Sharing', text: <>Shared {target} with someone as <Name>{roleWord(m.level)}</Name></> }
    }
    case 'share_revoke': {
      if (entry.resourceType === 'SHARE_LINK') {
        const fileName = resolve?.('FILE', m.fileId as string)
        return { icon: KeyRound, tone: 'text-[#ff7b70] bg-danger/10', category: 'Share link', text: <>Revoked a share link{fileName ? <> for <Name>{fileName}</Name></> : ''}</> }
      }
      // The backend records role changes and re-shares under share_revoke as well.
      if (m.updated || (m.level && m.previousLevel)) {
        return {
          icon: UserCog, tone: 'text-info bg-info/10', category: 'Sharing',
          text: m.previousLevel
            ? <>Changed someone’s access to {target} from {roleWord(m.previousLevel)} to <Name>{roleWord(m.level)}</Name></>
            : <>Updated someone’s access to {target} to <Name>{roleWord(m.level)}</Name></>,
        }
      }
      return { icon: UserMinus, tone: 'text-[#ff7b70] bg-danger/10', category: 'Sharing', text: <>Removed someone’s access to {target}</> }
    }
    case 'share_access': {
      const fileName = str(m.filename) ?? resolve?.('FILE', m.fileId as string)
      return { icon: Eye, tone: 'text-info bg-info/10', category: 'Share link', text: <>A share link{fileName ? <> for <Name>{fileName}</Name></> : ''} was opened</> }
    }
    case 'auth_login':
      return { icon: LogIn, tone: 'text-success bg-success/10', category: 'Account', text: <>Signed in</> }
    case 'auth_logout':
      return { icon: LogOut, tone: 'text-muted-foreground bg-white/5', category: 'Account', text: <>Signed out</> }
    case 'auth_failed_login':
      return { icon: ShieldAlert, tone: 'text-danger bg-danger/10', category: 'Account', text: <>Failed sign-in attempt</> }
    case 'auth_password_change':
      return { icon: KeyRound, tone: 'text-warning bg-warning/10', category: 'Account', text: <>Changed password</> }
    default:
      return { icon: Pencil, tone: 'text-muted-foreground bg-white/5', category: 'Other', text: <>{String(entry.action).replace(/_/g, ' ')}</> }
  }
}

export function ActivityItem({ entry, resolve, compact = false, showTime = 'relative' }: {
  entry: ActivityLogEntry
  resolve?: NameResolver
  compact?: boolean
  showTime?: 'relative' | 'clock'
}) {
  const d = describeActivity(entry, resolve)
  return (
    <li className={cn('relative flex gap-3', compact ? 'py-2.5' : 'py-3')}>
      <span className={cn('relative z-[1] mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded', d.tone)}>
        <d.icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm leading-6 text-muted-foreground">{d.text}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
          <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
            {showTime === 'clock' ? formatTime(entry.createdAt) : formatRelative(entry.createdAt)}
          </time>
          {entry.performedByYou === false && (
            <><span aria-hidden="true">·</span><span>{entry.anonymous ? 'by a share-link visitor' : `by ${entry.user?.name ?? 'another user'}`}</span></>
          )}
          {!compact && <><span aria-hidden="true">·</span><span>{d.category}</span></>}
          {!compact && entry.ipAddress && <><span aria-hidden="true">·</span><span className="font-mono">{entry.ipAddress}</span></>}
        </p>
      </div>
    </li>
  )
}
