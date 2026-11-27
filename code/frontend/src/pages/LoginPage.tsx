import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { getErrorMessage } from '@lib/format'
import { AuthAlert, AuthField, AuthShell, EMAIL_RE, PasswordField } from '@components/auth/AuthShell'

type Errors = { email?: string; password?: string }

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  useEffect(() => {
    if (isAuthenticated && !busy) navigate(from, { replace: true })
  }, [isAuthenticated, busy, from, navigate])

  function validate(): Errors {
    const next: Errors = {}
    if (!email.trim()) next.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address, like name@company.com.'
    if (!password) next.password = 'Enter your password.'
    return next
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    setServerError('')
    if (next.email) return emailRef.current?.focus()
    if (next.password) return passwordRef.current?.focus()
    setBusy(true)
    try {
      await login(email.trim(), password)
      setSuccess(true)
      navigate(from, { replace: true })
    } catch (error) {
      setBusy(false)
      setServerError(getErrorMessage(error, 'Invalid email or password.'))
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title={<>Sign in to your <span>vault.</span></>}
      subtitle="Access your files, shared folders, and activity."
      footer={<>New to NimbusVault? <Link to="/register">Create an account <ArrowRight size={13} aria-hidden="true" /></Link></>}
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        {serverError && <AuthAlert>{serverError}</AuthAlert>}
        {success && <AuthAlert tone="success">Signed in. Opening your vault…</AuthAlert>}
        <AuthField
          ref={emailRef}
          id="login-email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })) }}
          placeholder="you@company.com"
          error={errors.email}
          disabled={busy}
          autoFocus
        />
        <PasswordField
          ref={passwordRef}
          id="login-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((x) => ({ ...x, password: undefined })) }}
          placeholder="Your password"
          error={errors.password}
          disabled={busy}
        />
        <button className="auth-submit" disabled={busy} type="submit">
          {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Signing in…</> : <>Sign in <ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </form>
    </AuthShell>
  )
}
