import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Download, Eye, KeyRound, Link2, ShieldCheck } from 'lucide-react'
import { shareLinkApi, type ShareLink } from '@services/shareLinks'
import { formatDateTime, formatRelative, getErrorMessage } from '@lib/format'
import { cn } from '@lib/utils'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Field, Input, Select } from './ui/Input'
import { Badge, EmptyState, ErrorState, Skeleton } from './ui/primitives'
import { useToast } from './ui/Toast'
import { FileTypeIcon } from './files/FileTypeIcon'

interface ShareLinkDialogProps {
  open: boolean
  onClose: () => void
  file: { id: string; filename: string; mimeType?: string; category?: string } | null
}

type Expiry = '1' | '7' | '30' | 'never' | 'custom'

type LinkStatus = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; active: boolean }

export const linkStatus = (link: ShareLink): LinkStatus => {
  if (link.revokedAt) return { label: 'Revoked', tone: 'neutral', active: false }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return { label: 'Expired', tone: 'warning', active: false }
  if (link.maxDownloads && link.downloadCount >= link.maxDownloads) return { label: 'Limit reached', tone: 'warning', active: false }
  return { label: 'Active', tone: 'success', active: true }
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ShareLinkDialog({ open, onClose, file }: ShareLinkDialogProps) {
  const toast = useToast()
  const [links, setLinks] = useState<ShareLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [permission, setPermission] = useState<'VIEW' | 'DOWNLOAD'>('DOWNLOAD')
  const [expiry, setExpiry] = useState<Expiry>('7')
  const [customExpiry, setCustomExpiry] = useState('')
  const [password, setPassword] = useState('')
  const [maxDownloads, setMaxDownloads] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!file) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await shareLinkApi.listShareLinks(file.id)
      const list = res.data?.shareLinks ?? []
      list.sort((a, b) => Number(linkStatus(b).active) - Number(linkStatus(a).active) || +new Date(b.createdAt) - +new Date(a.createdAt))
      setLinks(list)
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Couldn’t load share links.'))
    } finally {
      setLoading(false)
    }
  }, [file])

  useEffect(() => {
    if (!open) return
    setNewLink(null)
    setCopied(false)
    setErrors({})
    setPassword('')
    setMaxDownloads('')
    setExpiry('7')
    setCustomExpiry('')
    setPermission('DOWNLOAD')
    setConfirmRevoke(null)
    load()
  }, [open, load])

  if (!file) return null

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    let expiresAt: string | undefined
    if (expiry === 'custom') {
      const d = new Date(customExpiry)
      if (!customExpiry || Number.isNaN(d.getTime())) next.expiry = 'Choose a date and time.'
      else if (d <= new Date()) next.expiry = 'Pick a time in the future.'
      else expiresAt = d.toISOString()
    } else if (expiry !== 'never') {
      expiresAt = new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
    }
    if (password && password.length < 4) next.password = 'Use at least 4 characters.'
    if (permission === 'DOWNLOAD' && maxDownloads && (!/^\d+$/.test(maxDownloads) || Number(maxDownloads) < 1)) {
      next.maxDownloads = 'Enter a whole number of 1 or more.'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    setCreating(true)
    try {
      const res = await shareLinkApi.createShareLink({
        fileId: file.id,
        permission,
        password: password || undefined,
        expiresAt,
        maxDownloads: permission === 'DOWNLOAD' && maxDownloads ? Number(maxDownloads) : undefined,
      })
      if (res.data) {
        setNewLink(res.data.url)
        setCopied(false)
        setPassword('')
        setMaxDownloads('')
        toast.success('Share link created', 'Copy it now — it’s only shown once.')
        requestAnimationFrame(() => linkInputRef.current?.select())
        load()
      }
    } catch (err) {
      toast.error('Couldn’t create link', getErrorMessage(err, 'Please try again.'))
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    if (!newLink) return
    try {
      await navigator.clipboard.writeText(newLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      linkInputRef.current?.select()
      toast.info('Press Ctrl+C to copy', 'Your browser blocked clipboard access.')
    }
  }

  const revoke = async (id: string) => {
    setRevoking(id)
    try {
      await shareLinkApi.revokeShareLink(id)
      toast.success('Link revoked', 'Anyone using it will now see that access was removed.')
      await load()
    } catch (err) {
      toast.error('Couldn’t revoke link', getErrorMessage(err, 'Please try again.'))
    } finally {
      setRevoking(null)
      setConfirmRevoke(null)
    }
  }

  const activeCount = links.filter((l) => linkStatus(l).active).length

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={<span className="block truncate">Share link for “{file.filename}”</span>}
      description="Anyone with the link can open it — no account required."
      icon={<FileTypeIcon filename={file.filename} mimeType={file.mimeType} category={file.category} size="md" />}
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      {newLink && (
        <div className="mb-6 border border-success/30 bg-success/[0.06] p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Check className="h-4 w-4 text-success" aria-hidden="true" /> Link ready to share
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input ref={linkInputRef} readOnly value={newLink} aria-label="New share link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button onClick={copy} className="sm:w-[112px]">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">For security, the full link isn’t stored in a readable form and won’t be shown again.</p>
        </div>
      )}

      <form onSubmit={create} noValidate className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-foreground">Link access</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {([
              { value: 'DOWNLOAD', icon: Download, title: 'View and download', body: 'Recipients can download the file.' },
              { value: 'VIEW', icon: Eye, title: 'View details only', body: 'Shows name, type, and size. Downloading is off.' },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer gap-3 border p-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40',
                  permission === opt.value ? 'border-primary/60 bg-primary/[0.06]' : 'border-border-strong hover:bg-white/[0.03]'
                )}
              >
                <input type="radio" name="permission" value={opt.value} checked={permission === opt.value} onChange={() => setPermission(opt.value)} className="sr-only" />
                <opt.icon className={cn('mt-0.5 h-4 w-4 shrink-0', permission === opt.value ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-foreground">{opt.title}</span>
                  <span className="block text-xs text-muted-foreground">{opt.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires" error={errors.expiry}>
            {({ id, describedBy, invalid }) => (
              <div className="space-y-2">
                <Select id={id} value={expiry} onChange={(e) => { setExpiry(e.target.value as Expiry); if (e.target.value === 'custom' && !customExpiry) setCustomExpiry(toLocalInput(new Date(Date.now() + 86_400_000))) }} aria-describedby={describedBy}>
                  <option value="1">In 1 day</option>
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="never">Never</option>
                  <option value="custom">Custom date…</option>
                </Select>
                {expiry === 'custom' && (
                  <Input type="datetime-local" aria-label="Custom expiry date and time" value={customExpiry} min={toLocalInput(new Date())} onChange={(e) => setCustomExpiry(e.target.value)} invalid={invalid} />
                )}
              </div>
            )}
          </Field>
          <Field label="Password" optional error={errors.password} hint="Recipients must enter it to open the link.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 4 characters" aria-describedby={describedBy} invalid={invalid} />
            )}
          </Field>
          {permission === 'DOWNLOAD' && (
            <Field label="Download limit" optional error={errors.maxDownloads} hint="The link stops working after this many downloads.">
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="number" inputMode="numeric" min={1} value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="Unlimited" aria-describedby={describedBy} invalid={invalid} />
              )}
            </Field>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
            Short expiry plus a password is the safest way to share outside your team.
          </p>
          <Button type="submit" loading={creating} className="w-full sm:w-auto">
            {!creating && <Link2 className="h-4 w-4" />} Create link
          </Button>
        </div>
      </form>

      <div className="mt-6">
        <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
          <span>Links for this file</span>
          {!loading && !loadError && links.length > 0 && <span className="normal-case tracking-normal">{activeCount} active</span>}
        </h3>
        <div className="border border-border">
          {loading ? (
            <div className="space-y-3 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : loadError ? (
            <ErrorState title="Couldn’t load links" message={loadError} onRetry={load} className="py-8" />
          ) : links.length === 0 ? (
            <EmptyState compact icon={Link2} title="No links yet" description="Links you create appear here so you can track and revoke them." className="py-8" />
          ) : (
            <ul className="divide-y divide-border">
              {links.map((link) => {
                const status = linkStatus(link)
                const confirming = confirmRevoke === link.id
                return (
                  <li key={link.id} className={cn('flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center', !status.active && 'opacity-70')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <Badge icon={link.permission === 'DOWNLOAD' ? Download : Eye}>{link.permission === 'DOWNLOAD' ? 'View & download' : 'View only'}</Badge>
                        {link.maxDownloads ? <Badge>{link.downloadCount}/{link.maxDownloads} downloads</Badge> : link.downloadCount > 0 ? <Badge>{link.downloadCount} downloads</Badge> : null}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Created {formatRelative(link.createdAt)} ·{' '}
                        {link.revokedAt
                          ? `Revoked ${formatRelative(link.revokedAt)}`
                          : link.expiresAt
                            ? `${status.label === 'Expired' ? 'Expired' : 'Expires'} ${formatDateTime(link.expiresAt)}`
                            : 'Never expires'}
                      </p>
                    </div>
                    {status.active && (
                      confirming ? (
                        <div className="flex items-center gap-2" role="group" aria-label="Confirm revoking link">
                          <span className="text-xs text-muted-foreground">Revoke this link?</span>
                          <Button size="xs" variant="ghost" onClick={() => setConfirmRevoke(null)} disabled={revoking === link.id}>Cancel</Button>
                          <Button size="xs" variant="destructive" onClick={() => revoke(link.id)} loading={revoking === link.id} autoFocus>Revoke</Button>
                        </div>
                      ) : (
                        <Button size="xs" variant="ghost" className="self-start text-[#ff7b70] hover:bg-danger/10 hover:text-[#ff7b70] sm:self-auto" onClick={() => setConfirmRevoke(link.id)}>
                          <KeyRound className="h-3.5 w-3.5" /> Revoke
                        </Button>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  )
}
