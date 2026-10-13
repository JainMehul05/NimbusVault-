import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '@lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'xs'
}

const buttonVariants = {
  default: 'inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-all',
  outline: 'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-all',
  ghost: 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-all',
  destructive: 'inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-all',
  link: 'inline-flex items-center justify-center gap-2 text-sm font-semibold underline-offset-4 hover:underline text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
}

const sizeVariants = {
  default: 'h-10 px-4',
  sm: 'h-9 px-3 text-xs',
  lg: 'h-11 px-8',
  xs: 'h-7 px-2 text-xs',
  icon: 'h-10 w-10',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants[variant], sizeVariants[size], className)}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'