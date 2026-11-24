import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react'
import { cn } from '@lib/utils'
import { initials } from '@lib/format'
import { Button } from './Button'

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-border-strong bg-white/[0.04] text-muted-foreground',
  brand: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-[#ff7b70]',
  info: 'border-info/30 bg-info/10 text-info',
}

export function Badge({ tone = 'neutral', children, className, icon: Icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-2xs font-semibold', badgeTones[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER'
export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' }
export const ROLE_DESCRIPTION: Record<Role, string> = {
  OWNER: 'Full control, including sharing and deletion',
  EDITOR: 'Can view, download, upload, rename, move, and share',
  VIEWER: 'Can view and download',
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === 'OWNER' ? 'brand' : role === 'EDITOR' ? 'info' : 'neutral'}>{ROLE_LABEL[role]}</Badge>
}

const avatarPalette = ['bg-[#3a1d0e] text-[#ff9a66]', 'bg-[#10283a] text-[#7cc8ff]', 'bg-[#22183a] text-[#c4a7ff]', 'bg-[#123326] text-[#6fe0a0]', 'bg-[#3a1a24] text-[#ff8fb1]']

export function Avatar({ name, size = 'md', className }: { name?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const hash = (name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-bold',
        avatarPalette[hash % avatarPalette.length],
        size === 'sm' && 'h-6 w-6 text-[10px]',
        size === 'md' && 'h-8 w-8 text-xs',
        size === 'lg' && 'h-10 w-10 text-sm',
        className
      )}
    >
      {initials(name)}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded', className)} aria-hidden="true" />
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-10' : 'py-16', className)}>
      <div className="relative mb-4 grid h-12 w-12 place-items-center border border-border-strong bg-surface-raised text-muted-foreground shadow-brand">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-md font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: { title?: string; message?: string | null; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid h-12 w-12 place-items-center border border-danger/30 bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-md font-semibold text-foreground">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          <RotateCw className="h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative grid h-7 w-7 place-items-center border border-primary bg-[#120a06] text-[13px] font-black text-primary [transform:skew(-10deg)]">
        <span className="[transform:skew(10deg)]">N</span>
      </span>
      {!compact && (
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-foreground">
          NIMBUS<span className="text-primary">VAULT</span>
        </span>
      )}
    </span>
  )
}

/** Section card used across app pages. */
export function Panel({ title, action, children, className, bodyClassName }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('border border-border bg-surface shadow-e1', className)}>
      {(title || action) && (
        <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
