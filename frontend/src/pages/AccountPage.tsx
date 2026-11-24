import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Laptop, LogOut } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { authApi, type Session } from '@services/auth'
import { formatRelative, getErrorMessage } from '@lib/format'
import { passwordProblem } from '@lib/password'
import { describeDevice } from '@lib/userAgent'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { Field, Input } from '@components/ui/Input'
import { Avatar, Badge, ErrorState, Panel, Skeleton } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found: typeof errors = {}
    if (!current) found.current = 'Enter your current password.'
    const problem = passwordProblem(next)
    if (problem) found.next = problem
    else if (next === current) found.next = 'Choose a password you’re not already using.'
    if (confirm !== next) found.confirm = 'Passwords don’t match.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      await authApi.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Password changed', 'Your other devices were signed out.')
      onChanged()
    } catch (err) {
      setErrors({ form: getErrorMessage(err, 'Couldn’t change your password. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Password" bodyClassName="p-4 sm:p-5">
      <form onSubmit={submit} noValidate className="max-w-md space-y-4">
        {errors.form && <p role="alert" className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-[#ff7b70]">{errors.form}</p>}
        <Field label="Current password" error={errors.current}>
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} />}
        </Field>
        <Field label="New password" error={errors.next} hint="At least 8 characters, with a letter and a number or symbol.">
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />}
        </Field>
        <Button type="submit" loading={busy}><KeyRound className="h-4 w-4" /> Change password</Button>
      </form>
    </Panel>
  )
}

export function AccountPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setSessions(await authApi.sessions())
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load your sessions.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id)
    try {
      await action()
      toast.success(done)
      await load()
    } catch (err) {
      toast.error('Couldn’t sign out', getErrorMessage(err, 'Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  const others = sessions?.filter((s) => !s.current) ?? []

  return (
    <AppShell title="Account" description="Your profile, password, and signed-in devices.">
      <div className="space-y-6">
        <Panel title="Profile" bodyClassName="flex items-center gap-4 p-4 sm:p-5">
          <Avatar name={user?.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-md font-semibold text-foreground">{user?.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </Panel>

        <ChangePassword onChanged={load} />

        <Panel
          title="Signed-in devices"
          action={others.length > 0 ? (
            <Button size="sm" variant="secondary" loading={busy === 'all'} onClick={() => run('all', authApi.revokeOtherSessions, 'Other devices signed out')}>
              <LogOut className="h-4 w-4" /> Sign out others
            </Button>
          ) : undefined}
        >
          {error ? (
            <ErrorState title="Couldn’t load devices" message={error} onRetry={load} className="py-10" />
          ) : !sessions ? (
            <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading devices"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-white/5 text-muted-foreground"><Laptop className="h-4 w-4" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{describeDevice(s.device)} {s.current && <Badge tone="success">This device</Badge>}</p>
                    <p className="truncate text-xs text-muted-foreground">Last active {formatRelative(s.lastUsedAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</p>
                  </div>
                  {!s.current && (
                    <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => run(s.id, () => authApi.revokeSession(s.id), 'Device signed out')} aria-label={`Sign out ${describeDevice(s.device)}`}>Sign out</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  )
}
