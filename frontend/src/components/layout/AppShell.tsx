import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ChevronsUpDown, FolderClosed, LayoutGrid, LogOut, Menu, Sparkles, Users, X } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { filesApi, type StorageInfo } from '@services/files'
import { formatFileSize } from '@lib/format'
import { cn } from '@lib/utils'
import { Avatar, Logo } from '@components/ui/primitives'
import { DropdownMenu } from '@components/ui/DropdownMenu'

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/files', label: 'My Files', icon: FolderClosed, end: false },
  { to: '/shared-with-me', label: 'Shared with me', icon: Users, end: false },
  { to: '/ask', label: 'Ask NimbusVault', icon: Sparkles, end: true },
  { to: '/activity', label: 'Activity', icon: Activity, end: true },
]

export function StorageMeter({ storage, className }: { storage: StorageInfo | null; className?: string }) {
  if (!storage) return <div className={cn('h-[62px]', className)} aria-hidden="true" />
  const quota = Number(storage.quota)
  const used = Number(storage.used)
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
  const tone = pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warning' : 'bg-primary'
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-foreground">Storage</span>
        <span className="text-muted-foreground">{pct < 1 && used > 0 ? '<1' : Math.round(pct)}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden bg-white/[0.08]"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={cn('h-full transition-[width] duration-slow', tone)} style={{ width: `${Math.max(pct, used > 0 ? 1.5 : 0)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatFileSize(used)} of {formatFileSize(quota)} used
      </p>
    </div>
  )
}

function SidebarContent({ storage, onNavigate }: { storage: StorageInfo | null; onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link to="/dashboard" onClick={onNavigate} aria-label="NimbusVault overview"><Logo /></Link>
      </div>
      <nav aria-label="Main" className="flex-1 px-3 pt-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group relative flex h-10 items-center gap-3 rounded px-3 text-sm font-medium transition-colors duration-fast',
                    isActive
                      ? 'bg-primary/10 text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:bg-primary'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn('h-[18px] w-[18px]', isActive ? 'text-primary' : 'text-subtle group-hover:text-muted-foreground')} aria-hidden="true" />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-4 border-t border-border p-4">
        <StorageMeter storage={storage} />
        <DropdownMenu
          label="Account"
          align="start"
          items={[{ label: 'Sign out', icon: LogOut, onSelect: async () => { await logout(); navigate('/login') } }]}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="flex w-full items-center gap-3 rounded border border-border bg-white/[0.02] p-2 text-left transition-colors hover:bg-white/[0.05]"
            >
              <Avatar name={user?.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{user?.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 text-subtle" aria-hidden="true" />
              <span className="sr-only">Account menu</span>
            </button>
          )}
        />
      </div>
    </div>
  )
}

interface AppShellProps {
  title: ReactNode
  description?: ReactNode
  /** Primary actions shown at the right of the page header. */
  actions?: ReactNode
  /** Content rendered between the header and the page body (e.g. breadcrumbs). */
  headerExtra?: ReactNode
  /** Pass when the page already loads storage, to avoid a second request. */
  storage?: StorageInfo | null
  children: ReactNode
}

export function AppShell({ title, description, actions, headerExtra, storage: storageProp, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ownStorage, setOwnStorage] = useState<StorageInfo | null>(null)
  const location = useLocation()
  const storage = storageProp !== undefined ? storageProp : ownStorage

  useEffect(() => {
    if (storageProp !== undefined) return
    filesApi.storage().then(setOwnStorage).catch(() => {})
  }, [storageProp])

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [drawerOpen])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border bg-surface lg:block">
        <SidebarContent storage={storage} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link to="/dashboard" aria-label="NimbusVault overview"><Logo /></Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid h-10 w-10 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-black/70" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="relative h-full w-[min(300px,86vw)] animate-drawer-in border-r border-border bg-surface shadow-e3">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground"
              aria-label="Close navigation"
              autoFocus
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent storage={storage} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-[248px]">
        <main id="main" className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="app-title truncate text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
              {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </header>
          {headerExtra}
          {children}
        </main>
      </div>
    </div>
  )
}
