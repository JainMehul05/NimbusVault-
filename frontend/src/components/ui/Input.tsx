import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '@lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const control =
  'h-9 w-full rounded border border-border-strong bg-surface-sunken px-3 text-sm text-foreground placeholder:text-subtle ' +
  'transition-colors duration-fast hover:border-white/25 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25'

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', invalid, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(control, className)}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, invalid, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(control, 'cursor-pointer appearance-none pr-9', className)}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
  </div>
))
Select.displayName = 'Select'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Render prop receives ids to wire label, hint, and error to the control. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  className?: string
  optional?: boolean
}

/** Label + control + hint/error, with correct aria wiring. */
export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-foreground">
        {label}
        {optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-xs text-[#ff7b70]">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}
