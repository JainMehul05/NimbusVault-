import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, X } from 'lucide-react'
import type { UploadItem } from '@hooks/useFileManager'
import { formatFileSize } from '@lib/format'
import { cn } from '@lib/utils'
import { FileTypeIcon } from './FileTypeIcon'

/** Floating, collapsible upload queue with per-file progress and errors. */
export function UploadPanel({ uploads, onClear }: { uploads: UploadItem[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  if (uploads.length === 0) return null

  const active = uploads.filter((u) => u.status === 'uploading' || u.status === 'queued').length
  const failed = uploads.filter((u) => u.status === 'error').length
  const done = uploads.filter((u) => u.status === 'done').length
  const heading = active
    ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}…`
    : failed
      ? `${done} uploaded · ${failed} failed`
      : `${done} ${done === 1 ? 'upload' : 'uploads'} complete`

  return (
    <section
      aria-label="Uploads"
      className="fixed bottom-4 left-4 right-4 z-40 animate-toast-in border border-border-strong bg-surface-raised shadow-e2 sm:left-auto sm:w-[360px]"
    >
      <header className="flex h-12 items-center gap-2 border-b border-border pl-4 pr-2">
        {active ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /> : failed ? <AlertCircle className="h-4 w-4 text-danger" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
        <h2 className="flex-1 text-sm font-semibold text-foreground" aria-live="polite">{heading}</h2>
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'} aria-expanded={!collapsed}>
          <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
        {!active && (
          <button type="button" onClick={onClear} className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Clear finished uploads">
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      {!collapsed && (
        <ul className="max-h-[280px] divide-y divide-border overflow-y-auto">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileTypeIcon filename={u.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground" title={u.name}>{u.name}</p>
                {u.status === 'error' ? (
                  <p className="truncate text-xs text-[#ff7b70]" title={u.error}>{u.error}</p>
                ) : u.status === 'done' ? (
                  <p className="text-xs text-muted-foreground">{formatFileSize(u.size)} · Uploaded</p>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden bg-white/[0.08]" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.progress}>
                      <div className="h-full bg-primary transition-[width] duration-base" style={{ width: `${u.progress}%` }} />
                    </div>
                    <span className="w-9 text-right text-2xs tabular-nums text-muted-foreground">{u.status === 'queued' ? 'Queued' : `${u.progress}%`}</span>
                  </div>
                )}
              </div>
              {u.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Uploaded" />}
              {u.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-label="Failed" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
