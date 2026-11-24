import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@lib/utils'
import { Button } from './Button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Optional leading icon tile shown next to the title. */
  icon?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Prevents closing via Esc/overlay (e.g. while a request is in flight). */
  dismissible?: boolean
  /** Element to focus first; defaults to the first focusable control in the body. */
  initialFocusRef?: React.RefObject<HTMLElement>
}

/**
 * Accessible modal: role=dialog + aria-modal, labelled by its title, focus is trapped while
 * open and returned to the trigger on close, Esc and overlay click dismiss, body scroll locks.
 * On narrow screens it docks to the bottom as a sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocusRef,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusFirst = () => {
      const panel = panelRef.current
      if (!panel) return
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const body = panel.querySelector<HTMLElement>('[data-dialog-body]')
      const target = body?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(target ?? panel).focus()
    }
    const raf = requestAnimationFrame(focusFirst)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      )
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open, initialFocusRef])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div
        className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-[2px]"
        aria-hidden="true"
        onMouseDown={() => dismissible && onClose()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92svh] w-full animate-dialog-in flex-col border border-border-strong border-t-2 border-t-primary bg-surface shadow-e3 focus:outline-none',
          'rounded-t-lg sm:rounded-lg',
          size === 'sm' && 'sm:max-w-[420px]',
          size === 'md' && 'sm:max-w-[520px]',
          size === 'lg' && 'sm:max-w-[680px]'
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-md font-semibold leading-6 text-foreground">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {dismissible && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close dialog" className="-mr-2 -mt-1">
              <X className="h-4 w-4" />
            </Button>
          )}
        </header>
        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface-sunken/60 px-5 py-3 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'default'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Replaces window.confirm with an on-brand, keyboard-accessible confirmation. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="sm"
      dismissible={!loading}
      initialFocusRef={cancelRef}
      title={title}
      icon={
        tone === 'danger' ? (
          <span className="grid h-9 w-9 place-items-center rounded bg-danger/10 text-danger">
            <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'destructive' : 'default'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-6 text-muted-foreground">{description}</div>
    </Dialog>
  )
}
