import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default = primary brand action. Use one primary action per view. */
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'xs'
  loading?: boolean
}

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded font-semibold transition-colors duration-fast ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0'

const buttonVariants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary',
  secondary: 'border border-border-strong bg-surface-raised text-foreground hover:bg-[#1f1f1f] hover:border-white/25',
  outline: 'border border-border-strong bg-transparent text-foreground hover:bg-surface-raised',
  ghost: 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
  destructive: 'bg-danger text-destructive-foreground hover:bg-danger/90',
  link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
}

const sizeVariants = {
  default: 'h-9 px-4 text-sm',
  sm: 'h-8 px-3 text-sm',
  lg: 'h-11 px-6 text-base',
  xs: 'h-7 px-2 text-xs',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', loading = false, disabled, children, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(base, buttonVariants[variant], variant !== 'link' && sizeVariants[size], className)}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
