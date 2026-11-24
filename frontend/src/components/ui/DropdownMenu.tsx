import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@lib/utils'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
  /** Draws a divider above this item. */
  separated?: boolean
}

interface DropdownMenuProps {
  items: MenuItem[]
  /** Render the trigger; spread the given props onto a <button>. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>
    onClick: (e: React.MouseEvent) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    'aria-haspopup': 'menu'
    'aria-expanded': boolean
    'aria-controls': string | undefined
  }) => ReactNode
  align?: 'start' | 'end'
  label: string
}

const MENU_WIDTH = 216

/** Accessible action menu: arrow keys / Home / End move focus, Esc or outside click closes. */
export function DropdownMenu({ items, trigger, align = 'end', label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect()
    if (!t) return
    const estimatedHeight = items.length * 36 + 12
    const up = t.bottom + estimatedHeight + 8 > window.innerHeight && t.top > estimatedHeight
    let left = align === 'end' ? t.right - MENU_WIDTH : t.left
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top: up ? t.top - 4 : t.bottom + 4, left, up })
  }, [align, items.length])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return
      close(false)
    }
    const onScroll = () => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close])

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const idx = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); nodes[(idx + 1) % nodes.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nodes[(idx - 1 + nodes.length) % nodes.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); nodes[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); nodes[nodes.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') { close(false) }
  }

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: (e) => { e.stopPropagation(); setOpen((o) => !o) },
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true) }
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
      })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH, transform: pos.up ? 'translateY(-100%)' : undefined }}
            className="fixed z-[60] animate-fade-in rounded-md border border-border-strong bg-surface-raised p-1.5 shadow-e2"
          >
            {items.map((item) => (
              <div key={item.label}>
                {item.separated && <div className="my-1.5 h-px bg-border" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => { close(); item.onSelect() }}
                  className={cn(
                    'flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-left text-sm transition-colors duration-fast focus:outline-none',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    item.tone === 'danger'
                      ? 'text-[#ff7b70] hover:bg-danger/10 focus:bg-danger/10'
                      : 'text-foreground hover:bg-white/[0.06] focus:bg-white/[0.06]'
                  )}
                >
                  {item.icon && <item.icon className="h-4 w-4 opacity-80" aria-hidden="true" />}
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
