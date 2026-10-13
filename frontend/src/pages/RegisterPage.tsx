import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Terminal, Zap } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { Button } from '@components/ui/Button'
import { Input } from '@components/ui/Input'
import { cn } from '@lib/utils'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const getStrength = (pwd: string) => {
    if (pwd.length >= 12) return { label: 'Strong access key', className: 'strength-strong' }
    if (pwd.length >= 8) return { label: 'Good access key', className: 'strength-good' }
    return { label: 'Use at least 8 characters', className: 'strength-weak' }
  }

  const strength = getStrength(password)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await register(name, email, password)
      setMessage('Account created. Redirecting...')
      navigate('/dashboard')
    } catch (error: any) {
      setBusy(false)
      setMessage(error?.response?.data?.message || 'Unable to create this account. Check your details and try again.')
    }
  }

  return (
    <AuthShell
      eyebrow="INITIALIZE ACCOUNT"
      title={<>Build your <span>secure layer.</span></>}
      subtitle="Create an account and bring your files into focus."
      footer={<>Already have access? <Link to="/login">Log in <ArrowRight size={13} /></Link></>}
    >
      <form onSubmit={submit} className="auth-form">
        <label>
          Full name
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            required
            disabled={busy}
          />
        </label>
        <label>
          Email address
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            disabled={busy}
          />
        </label>
        <label>
          Create access key
          <div className="password-field">
            <Input
              type={showPassword ? 'text' : 'password'}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              required
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide access key' : 'Show access key'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span className={cn('password-strength', strength.className)}>
            {password ? strength.label : 'Use at least 8 characters'}
          </span>
        </label>
        {message && <p className="auth-message">{message}</p>}
        <Button className="auth-submit" disabled={busy} type="submit">
          {busy ? 'Creating account...' : 'Start building'}
          <ArrowRight size={15} />
        </Button>
      </form>
    </AuthShell>
  )
}

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string
  title: React.ReactNode
  subtitle: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <main className="auth-page">
      <div className="auth-grid" />
      <Link to="/" className="auth-logo">
        <span className="auth-logo-mark"><Zap size={15} /></span>
        <span>NIMBUS<span>VAULT</span></span>
      </Link>
      <Link to="/" className="auth-back">
        <ArrowLeft size={14} /> Return home
      </Link>
      <section className="auth-card">
        <div className="auth-card-glow" />
        <div className="auth-topline">
          <Terminal size={14} /> SECURE ACCESS <span>v1.0.0</span>
        </div>
        <div className="auth-heading">
          <div className="section-kicker">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
        <p className="auth-footer">{footer}</p>
        <div className="auth-security"><LockKeyhole size={13} /> Encrypted session boundary</div>
      </section>
    </main>
  )
}