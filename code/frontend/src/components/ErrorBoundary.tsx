import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Logo } from './ui/primitives'
import { Button } from './ui/Button'

/** Last resort for rendering errors: shows a recovery page instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected interface error', error.message, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
        <Logo />
        <div className="mb-4 mt-10 grid h-12 w-12 place-items-center border border-danger/30 bg-danger/10 text-danger">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="app-title text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">This page hit an unexpected error. Your files are safe. Reload to continue.</p>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => window.location.reload()}><RotateCw className="h-4 w-4" /> Reload</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>Go home</Button>
        </div>
      </div>
    )
  }
}
