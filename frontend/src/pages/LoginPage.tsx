import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Terminal, Zap } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { Button } from '@components/ui/Button'
import { Input } from '@components/ui/Input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await login(email, password)
      setMessage('Access granted. Redirecting...')
      navigate('/dashboard')
    } catch (error: any) {
      setBusy(false)
      setMessage(error?.response?.data?.message || 'Invalid email or password.')
    }
  }

  return (
    <AuthShell
      eyebrow="RETURNING OPERATOR"
      title={<>Welcome back to the <span>vault.</span></>}
      subtitle="Authenticate to access your protected workspace."
      footer={<>New to NimbusVault? <Link to="/register">Create an account <ArrowRight size={13} /></Link></>}
    >
      <form onSubmit={submit} className="auth-form">
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
          Access key
          <div className="password-field">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
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
        </label>
        {message && <p className="auth-message">{message}</p>}
        <Button className="auth-submit" disabled={busy} type="submit">
          {busy ? 'Authenticating...' : 'Enter workspace'}
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