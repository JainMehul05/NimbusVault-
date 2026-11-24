import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Folder, Info, UserPlus, Users } from 'lucide-react'
import { useAuth } from '@context/AuthContext'
import { sharingApi, type SharePermission } from '@services/sharing'
import { getErrorMessage } from '@lib/format'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Field, Input, Select } from './ui/Input'
import { Avatar, EmptyState, ErrorState, RoleBadge, ROLE_DESCRIPTION, Skeleton } from './ui/primitives'
import { useToast } from './ui/Toast'
import { FileTypeIcon } from './files/FileTypeIcon'

type Level = 'VIEWER' | 'EDITOR'

export interface ShareTarget {
  resourceType: 'FILE' | 'FOLDER'
  resourceId: string
  resourceName: string
  mimeType?: string
  category?: string
}

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  target: ShareTarget | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ShareDialog({ open, onClose, target }: ShareDialogProps) {
  const { user } = useAuth()
  const toast = useToast()
  const [shares, setShares] = useState<SharePermission[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState<Level>('VIEWER')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [busyGrantee, setBusyGrantee] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!target) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await sharingApi.listShares(target.resourceType, target.resourceId)
      setShares(res.data?.shares ?? [])
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Couldn’t load who has access.'))
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => {
    if (!open) return
    setEmail('')
    setLevel('VIEWER')
    setEmailError(null)
    setConfirmRemove(null)
    load()
  }, [open, load])

  if (!target) return null
  const noun = target.resourceType === 'FILE' ? 'file' : 'folder'

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return setEmailError('Enter an email address.')
    if (!EMAIL_RE.test(value)) return setEmailError('Enter a valid email address, like name@company.com.')
    if (value === user?.email?.toLowerCase()) return setEmailError('You already own this ' + noun + '.')
    setEmailError(null)
    setInviting(true)
    try {
      const existing = shares.find((s) => s.grantee.email.toLowerCase() === value)
      const res = await sharingApi.createShare({ resourceType: target.resourceType, resourceId: target.resourceId, granteeEmail: value, level })
      const name = res.data?.grantee?.name ?? value
      toast.success(existing ? 'Access updated' : 'Access granted', `${name} is now ${level === 'EDITOR' ? 'an Editor' : 'a Viewer'}.`)
      setEmail('')
      await load()
    } catch (err) {
      setEmailError(getErrorMessage(err, 'Couldn’t share with that person.'))
    } finally {
      setInviting(false)
    }
  }

  const changeLevel = async (share: SharePermission, next: Level) => {
    if (next === share.level) return
    setBusyGrantee(share.grantee.id)
    try {
      await sharingApi.updateShare(target.resourceType, target.resourceId, share.grantee.id, { level: next })
      setShares((prev) => prev.map((s) => (s.grantee.id === share.grantee.id ? { ...s, level: next } : s)))
      toast.success('Role updated', `${share.grantee.name} is now ${next === 'EDITOR' ? 'an Editor' : 'a Viewer'}.`)
    } catch (err) {
      toast.error('Couldn’t change role', getErrorMessage(err, 'Please try again.'))
    } finally {
      setBusyGrantee(null)
    }
  }

  const remove = async (share: SharePermission) => {
    setBusyGrantee(share.grantee.id)
    try {
      await sharingApi.revokeShare(target.resourceType, target.resourceId, share.grantee.id)
      setShares((prev) => prev.filter((s) => s.grantee.id !== share.grantee.id))
      toast.success('Access removed', `${share.grantee.name} can no longer open this ${noun}.`)
    } catch (err) {
      toast.error('Couldn’t remove access', getErrorMessage(err, 'Please try again.'))
    } finally {
      setBusyGrantee(null)
      setConfirmRemove(null)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={<span className="block truncate">Share “{target.resourceName}”</span>}
      description="Invite people who have a NimbusVault account."
      icon={
        target.resourceType === 'FOLDER' ? (
          <span className="grid h-9 w-9 place-items-center rounded bg-primary/10 text-primary"><Folder className="h-[18px] w-[18px]" /></span>
        ) : (
          <FileTypeIcon filename={target.resourceName} mimeType={target.mimeType} category={target.category} size="md" />
        )
      }
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      <form onSubmit={invite} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Email address" error={emailError}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null) }}
                placeholder="name@company.com"
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={inviting}
              />
            )}
          </Field>
          <Field label="Role">
            {({ id }) => (
              <Select id={id} value={level} onChange={(e) => setLevel(e.target.value as Level)} disabled={inviting}>
                <option value="VIEWER">Viewer</option>
                <option value="EDITOR">Editor</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION[level]}.</p>
          <Button type="submit" loading={inviting} className="w-full sm:w-auto">
            {!inviting && <UserPlus className="h-4 w-4" />} Invite
          </Button>
        </div>
        {target.resourceType === 'FOLDER' && (
          <p className="flex items-start gap-2 rounded border border-border bg-white/[0.02] p-2.5 text-xs text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
            People you add get the same role on every file inside this folder.
          </p>
        )}
      </form>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">People with access</h3>
        <ul className="divide-y divide-border border border-border">
          <li className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={user?.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{user?.name} <span className="font-normal text-subtle">(you)</span></p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <RoleBadge role="OWNER" />
          </li>
          {loading ? (
            [0, 1].map((i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
              </li>
            ))
          ) : loadError ? (
            <li><ErrorState title="Couldn’t load collaborators" message={loadError} onRetry={load} className="py-8" /></li>
          ) : shares.length === 0 ? (
            <li><EmptyState compact icon={Users} title="Only you have access" description={`Invite someone above to collaborate on this ${noun}.`} className="py-8" /></li>
          ) : (
            shares.map((share) => {
              const busy = busyGrantee === share.grantee.id
              const confirming = confirmRemove === share.grantee.id
              return (
                <li key={share.grantee.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                  <Avatar name={share.grantee.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{share.grantee.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{share.grantee.email}</p>
                  </div>
                  {confirming ? (
                    <div className="flex w-full items-center justify-end gap-2 sm:w-auto" role="group" aria-label={`Confirm removing ${share.grantee.name}`}>
                      <span className="mr-1 text-xs text-muted-foreground">Remove access?</span>
                      <Button size="xs" variant="ghost" onClick={() => setConfirmRemove(null)} disabled={busy}>Cancel</Button>
                      <Button size="xs" variant="destructive" onClick={() => remove(share)} loading={busy} autoFocus>Remove</Button>
                    </div>
                  ) : (
                    <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
                      <div className="w-[116px]">
                        <Select
                          aria-label={`Role for ${share.grantee.name}`}
                          value={share.level}
                          onChange={(e) => changeLevel(share, e.target.value as Level)}
                          disabled={busy}
                          className="h-8 text-xs"
                        >
                          <option value="VIEWER">Viewer</option>
                          <option value="EDITOR">Editor</option>
                        </Select>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-[#ff7b70] hover:bg-danger/10 hover:text-[#ff7b70]"
                        onClick={() => setConfirmRemove(share.grantee.id)}
                        disabled={busy}
                        aria-label={`Remove ${share.grantee.name}`}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              )
            })
          )}
        </ul>
      </div>
    </Dialog>
  )
}
