import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { Logo } from '@components/ui/primitives'

export function NotFoundPage() {
  const { isAuthenticated } = useAuth()
  return (
    <main className="auth-page">
      <div className="auth-grid" />
      <Link to="/" className="auth-logo" aria-label="NimbusVault home"><Logo /></Link>
      <section className="auth-card text-center" aria-labelledby="nf-title">
        <div className="auth-card-glow" />
        <div className="relative mx-auto mb-5 mt-4 grid h-12 w-12 place-items-center border border-border-strong bg-surface-raised text-muted-foreground">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="section-kicker relative">Error 404</p>
        <h1 id="nf-title" className="app-title relative mt-3 text-3xl font-bold text-foreground">This page doesn’t exist.</h1>
        <p className="relative mx-auto mt-2 max-w-xs text-sm text-muted-foreground">The link may be broken, or the page may have moved.</p>
        <Link to={isAuthenticated ? '/dashboard' : '/'} className="auth-submit relative mt-8">
          {isAuthenticated ? 'Go to your vault' : 'Back to home'}
        </Link>
      </section>
    </main>
  )
}
