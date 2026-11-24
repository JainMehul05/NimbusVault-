import { Logo } from './ui/primitives'

export function PageLoader({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" role="status" aria-label={label}>
      <Logo />
      <div className="h-0.5 w-24 overflow-hidden bg-white/10"><div className="skeleton h-full w-full bg-primary" /></div>
    </div>
  )
}
