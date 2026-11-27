import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Ban, Clock, Download, Eye, EyeOff, Link2Off, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { startDownload } from '@services/files'
import { shareLinkApi, type ShareLinkAccessResponse } from '@services/shareLinks'
import { formatDateTime, formatFileSize, getFileTypeMeta } from '@lib/format'
import { Logo } from '@components/ui/primitives'
import { Button } from '@components/ui/Button'
import { FileTypeIcon } from '@components/files/FileTypeIcon'

type State =
  | { kind: 'loading' }
  | { kind: 'password'; error?: string }
  | { kind: 'ready'; data: ShareLinkAccessResponse }
  | { kind: 'unavailable'; title: string; message: string; icon: typeof Ban }

const errorCode = (err: unknown) => (err as { response?: { data?: { error?: { code?: string } }; status?: number } })?.response?.data?.error?.code

const unavailable = (code?: string, status?: number): State => {
  switch (code) {
    case 'SHARE_REVOKED': return { kind: 'unavailable', icon: Ban, title: 'This link was turned off', message: 'The owner revoked access. Ask them for a new link if you still need the file.' }
    case 'SHARE_EXPIRED': return { kind: 'unavailable', icon: Clock, title: 'This link has expired', message: 'Share links can be set to expire. Ask the owner to send you a fresh one.' }
    case 'SHARE_EXHAUSTED': return { kind: 'unavailable', icon: Ban, title: 'Download limit reached', message: 'This link allowed a set number of downloads and they’ve all been used.' }
    case 'RATE_LIMIT_EXCEEDED': return { kind: 'unavailable', icon: AlertTriangle, title: 'Too many attempts', message: 'For security, this link is paused for a few minutes. Please try again shortly.' }
    default:
      if (status === undefined) return { kind: 'unavailable', icon: AlertTriangle, title: 'Can’t reach NimbusVault', message: 'Check your connection and reload the page.' }
      return { kind: 'unavailable', icon: Link2Off, title: 'Link not found', message: 'This link is invalid or the file is no longer available. Check that you copied the whole link.' }
  }
}

export function PublicSharePage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const access = useCallback(async (pwd?: string) => {
    try {
      const res = await shareLinkApi.accessShareLink(token, pwd)
      if (res.data) setState({ kind: 'ready', data: res.data })
    } catch (err) {
      const code = errorCode(err)
      const status = (err as { response?: { status?: number } })?.response?.status
      if (code === 'PASSWORD_REQUIRED') setState({ kind: 'password' })
      else if (code === 'INVALID_PASSWORD') setState({ kind: 'password', error: 'That password isn’t right. Check with the person who shared it.' })
      else setState(unavailable(code, status))
    }
  }, [token])

  useEffect(() => { access() }, [access])

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setState({ kind: 'password', error: 'Enter the password to continue.' })
    setSubmitting(true)
    await access(password)
    setSubmitting(false)
  }

  const download = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = await shareLinkApi.downloadShareLink(token, password || undefined)
      if (res.data?.downloadUrl) startDownload(res.data.downloadUrl)
    } catch (err) {
      const next = unavailable(errorCode(err), (err as { response?: { status?: number } })?.response?.status)
      if (next.kind === 'unavailable') setDownloadError(`${next.title}. ${next.message}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-grid" />
      <Link to="/" className="auth-logo" aria-label="NimbusVault home"><Logo /></Link>
      <section className="auth-card" aria-live="polite" aria-busy={state.kind === 'loading'}>
        <div className="auth-card-glow" />
        <div className="auth-topline"><ShieldCheck size={14} /> SHARED FILE <span>NIMBUSVAULT</span></div>

        {state.kind === 'loading' && (
          <div className="relative flex flex-col items-center py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">Checking this link…</p>
          </div>
        )}

        {state.kind === 'password' && (
          <form onSubmit={submitPassword} noValidate className="auth-form relative mt-8">
            <div className="auth-heading !my-0 !mb-2">
              <div className="section-kicker">PROTECTED LINK</div>
              <h1>Enter the <span>password.</span></h1>
              <p>The owner added a password to this file.</p>
            </div>
            <div className="auth-field">
              <label htmlFor="share-password">Password</label>
              <div className="password-field">
                <input
                  id="share-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  autoFocus
                  aria-invalid={!!state.error || undefined}
                  aria-describedby={state.error ? 'share-password-error' : undefined}
                  disabled={submitting}
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {state.error && <p id="share-password-error" className="field-error" role="alert"><AlertTriangle size={13} /> {state.error}</p>}
            </div>
            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Checking…</> : <><LockKeyhole size={15} /> Unlock file</>}
            </button>
          </form>
        )}

        {state.kind === 'unavailable' && (
          <div className="relative py-10 text-center">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center border border-border-strong bg-surface-raised text-muted-foreground">
              <state.icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">{state.title}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{state.message}</p>
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="relative mt-8">
            <div className="flex items-start gap-4">
              <FileTypeIcon filename={state.data.file.filename} mimeType={state.data.file.mimeType} category={state.data.file.category} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Someone shared a file with you</p>
                <h1 className="mt-1 break-words text-xl font-semibold leading-tight text-foreground">{state.data.file.filename}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getFileTypeMeta(state.data.file.filename, state.data.file.mimeType, state.data.file.category).label} · {formatFileSize(state.data.file.sizeBytes)}
                </p>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-px border border-border bg-border text-sm">
              <div className="bg-surface p-3">
                <dt className="text-xs text-subtle">Access</dt>
                <dd className="mt-0.5 font-medium text-foreground">{state.data.permission === 'DOWNLOAD' ? 'View & download' : 'View only'}</dd>
              </div>
              <div className="bg-surface p-3">
                <dt className="text-xs text-subtle">Link expires</dt>
                <dd className="mt-0.5 font-medium text-foreground">{state.data.expiresAt ? formatDateTime(state.data.expiresAt) : 'Never'}</dd>
              </div>
            </dl>
            {state.data.permission === 'DOWNLOAD' ? (
              <Button size="lg" className="mt-6 w-full rounded-none" onClick={download} loading={downloading}>
                {!downloading && <Download className="h-4 w-4" />} Download file
              </Button>
            ) : (
              <p className="mt-6 flex items-start gap-2 border border-border bg-white/[0.02] p-3 text-sm text-muted-foreground">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                The owner shared this file for viewing details only, so downloading is turned off.
              </p>
            )}
            {downloadError && <p role="alert" className="mt-3 text-sm text-[#ff7b70]">{downloadError}</p>}
          </div>
        )}

        <div className="auth-security"><LockKeyhole size={13} /> Shared securely with NimbusVault</div>
        <p className="auth-footer">Want your own secure vault? <Link to="/register">Create an account</Link></p>
      </section>
    </main>
  )
}
