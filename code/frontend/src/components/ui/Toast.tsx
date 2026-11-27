import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@lib/utils'

type Tone = 'success' | 'error' | 'info'
interface ToastItem { id: number; tone: Tone; title: string; description?: string }

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const noop: ToastApi = { success: () => {}, error: () => {}, info: () => {} }

/** Falls back to a no-op so components still render in isolation (e.g. tests). */
export const useToast = (): ToastApi => useContext(ToastContext) ?? noop

const toneStyles: Record<Tone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: AlertCircle, className: 'text-danger' },
  info: { icon: Info, className: 'text-info' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback((tone: Tone, title: string, description?: string) => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, tone, title, description }])
    window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500)
  }, [dismiss])

  const api = useMemo<ToastApi>(() => ({
    success: (t, d) => push('success', t, d),
    error: (t, d) => push('error', t, d),
    info: (t, d) => push('info', t, d),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = toneStyles[toast.tone]
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-md border border-border-strong bg-surface-raised p-3.5 shadow-e2"
            >
              <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{toast.title}</p>
                {toast.description && <p className="mt-0.5 break-words text-sm text-muted-foreground">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
