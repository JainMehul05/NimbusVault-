import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Logo } from '@components/ui/primitives'

export function AuthShell({ eyebrow, title, subtitle, children, footer }: {
  eyebrow: string
  title: ReactNode
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="auth-page">
      <div className="auth-grid" />
      <Link to="/" className="auth-logo" aria-label="NimbusVault home"><Logo /></Link>
      <Link to="/" className="auth-back"><ArrowLeft size={14} aria-hidden="true" /> Back to home</Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-glow" />
        <div className="auth-topline"><ShieldCheck size={14} aria-hidden="true" /> SECURE ACCESS</div>
        <div className="auth-heading">
          <div className="section-kicker">{eyebrow}</div>
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
        <p className="auth-footer">{footer}</p>
        <div className="auth-security"><LockKeyhole size={13} aria-hidden="true" /> Encrypted connection · Short-lived sessions</div>
      </section>
    </main>
  )
}

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string | null
  hint?: ReactNode
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField({ id, label, error, hint, ...input }, ref) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy} {...input} />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : hint ? <div id={`${id}-hint`}>{hint}</div> : null}
    </div>
  )
})

export const PasswordField = forwardRef<HTMLInputElement, AuthFieldProps>(function PasswordField({ id, label, error, hint, ...input }, ref) {
  const [visible, setVisible] = useState(false)
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input ref={ref} id={id} type={visible ? 'text' : 'password'} aria-invalid={!!error || undefined} aria-describedby={describedBy} {...input} />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : hint ? <div id={`${id}-hint`}>{hint}</div> : null}
    </div>
  )
})

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="field-error"><AlertCircle size={13} aria-hidden="true" /> {children}</p>
}

export function AuthAlert({ tone = 'error', children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  return (
    <p className={`auth-alert ${tone === 'success' ? 'success' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
      <span>{children}</span>
    </p>
  )
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
