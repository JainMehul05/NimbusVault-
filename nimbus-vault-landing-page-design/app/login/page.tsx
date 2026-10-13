'use client'

import { FormEvent, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Terminal, Zap } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    setBusy(false); setMessage(error ? 'Invalid email or password.' : 'Access granted. Redirecting...')
    if (!error) window.location.href = '/workspace'
  }
  return <AuthShell eyebrow="RETURNING OPERATOR" title={<>Welcome back to the <span>vault.</span></>} subtitle="Authenticate to access your protected workspace." footer={<>New to NimbusVault? <Link href="/register">Create an account <ArrowRight size={13} /></Link></>}>
    <form onSubmit={submit} className="auth-form"><label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required /></label><label>Access key<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide access key' : 'Show access key'}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>{message && <p className="auth-message">{message}</p>}<button className="button auth-submit" disabled={busy}>{busy ? 'Authenticating...' : 'Enter workspace'} <ArrowRight size={15} /></button></form>
  </AuthShell>
}

function AuthShell({ eyebrow, title, subtitle, children, footer }: { eyebrow: string; title: React.ReactNode; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) { return <main className="auth-page"><div className="auth-grid" /><Link href="/" className="auth-logo"><span className="auth-logo-mark"><Zap size={15} /></span><span>NIMBUS<span>VAULT</span></span></Link><Link href="/" className="auth-back"><ArrowLeft size={14} /> Return home</Link><section className="auth-card"><div className="auth-card-glow" /><div className="auth-topline"><Terminal size={14} /> SECURE ACCESS <span>v1.0.0</span></div><div className="auth-heading"><div className="section-kicker">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{children}<p className="auth-footer">{footer}</p><div className="auth-security"><LockKeyhole size={13} /> Encrypted session boundary</div></section></main> }
