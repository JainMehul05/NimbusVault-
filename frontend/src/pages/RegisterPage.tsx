import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { getErrorMessage } from '@lib/format'
import { passwordProblem } from '@lib/password'
import { cn } from '@lib/utils'
import { AuthAlert, AuthField, AuthShell, EMAIL_RE, PasswordField } from '@components/auth/AuthShell'

type Errors = { name?: string; email?: string; password?: string }

/** Length plus character variety; mirrors the backend minimum of 8 characters. */
export function passwordStrength(pwd: string) {
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pwd)).length
  if (pwd.length < 8) return { label: 'Use at least 8 characters', className: 'strength-weak' }
  if (passwordProblem(pwd)) return { label: 'Add a number or symbol', className: 'strength-weak' }
  if (pwd.length >= 12 && variety >= 3) return { label: 'Strong password', className: 'strength-strong' }
  if (pwd.length >= 12 || variety >= 3) return { label: 'Good — add length or symbols to make it stronger', className: 'strength-good' }
  return { label: 'Fair — try 12+ characters with numbers or symbols', className: 'strength-good' }
}

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const { register, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const refs = { name: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) }

  useEffect(() => {
    if (isAuthenticated && !busy) navigate('/dashboard', { replace: true })
  }, [isAuthenticated, busy, navigate])

  const strength = passwordStrength(password)

  function validate(): Errors {
    const next: Errors = {}
    if (name.trim().length < 2) next.name = name.trim() ? 'Name must be at least 2 characters.' : 'Enter your full name.'
    else if (name.trim().length > 100) next.name = 'Keep your name under 100 characters.'
    if (!email.trim()) next.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address, like name@company.com.'
    const problem = passwordProblem(password)
    if (problem) next.password = problem
    return next
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    setServerError('')
    const firstInvalid = (['name', 'email', 'password'] as const).find((k) => next[k])
    if (firstInvalid) return refs[firstInvalid].current?.focus()
    setBusy(true)
    try {
      await register(name.trim(), email.trim(), password)
      setSuccess(true)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setBusy(false)
      setServerError(getErrorMessage(error, 'We couldn’t create your account. Check your details and try again.'))
    }
  }

  const clear = (k: keyof Errors) => errors[k] && setErrors((x) => ({ ...x, [k]: undefined }))

  return (
    <AuthShell
      eyebrow="Create account"
      title={<>Start your <span>secure vault.</span></>}
      subtitle="Store, organize, and share files with the people you choose."
      footer={<>Already have an account? <Link to="/login">Sign in <ArrowRight size={13} aria-hidden="true" /></Link></>}
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        {serverError && (
          <AuthAlert>
            {serverError}
            {/already|exists|registered/i.test(serverError) && <> <Link to="/login" className="font-semibold text-primary underline-offset-2 hover:underline">Sign in instead</Link></>}
          </AuthAlert>
        )}
        {success && <AuthAlert tone="success">Account created. Opening your vault…</AuthAlert>}
        <AuthField
          ref={refs.name}
          id="register-name"
          label="Full name"
          autoComplete="name"
          value={name}
          onChange={(e) => { setName(e.target.value); clear('name') }}
          placeholder="Jordan Lee"
          error={errors.name}
          disabled={busy}
          autoFocus
        />
        <AuthField
          ref={refs.email}
          id="register-email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); clear('email') }}
          placeholder="you@company.com"
          error={errors.email}
          disabled={busy}
        />
        <PasswordField
          ref={refs.password}
          id="register-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); clear('password') }}
          placeholder="8+ characters"
          error={errors.password}
          disabled={busy}
          hint={
            <p className={cn('password-strength', password ? strength.className : '')}>
              <span className="strength-meter" aria-hidden="true"><i /><i /><i /></span>
              <span>{password ? strength.label : 'Use at least 8 characters'}</span>
            </p>
          }
        />
        <button className="auth-submit" disabled={busy} type="submit">
          {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Creating account…</> : <>Create account <ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </form>
    </AuthShell>
  )
}
