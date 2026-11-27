import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronRight, FolderInput, HardDrive } from 'lucide-react'
import type { FolderNode } from '@services/files'
import { cn } from '@lib/utils'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { FolderIcon } from './FileTypeIcon'

const INVALID_CHARS = /[\\/:*?"<>|]/

export function validateName(value: string, kind: 'file' | 'folder'): string | null {
  const v = value.trim()
  if (!v) return `Enter a ${kind} name.`
  if (v.length > 255) return 'Keep names under 255 characters.'
  if (INVALID_CHARS.test(v)) return 'Names can’t contain \\ / : * ? " < > |'
  if (v === '.' || v === '..') return 'Choose a different name.'
  return null
}

interface NameDialogProps {
  open: boolean
  mode: 'create-folder' | 'rename-folder' | 'rename-file'
  initialValue?: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

export function NameDialog({ open, mode, initialValue = '', onClose, onSubmit }: NameDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const kind = mode === 'rename-file' ? 'file' : 'folder'

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setError(null)
    setBusy(false)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      // Select the base name only so the extension is preserved by default.
      const dot = mode === 'rename-file' ? initialValue.lastIndexOf('.') : -1
      el.setSelectionRange(0, dot > 0 ? dot : initialValue.length)
    })
  }, [open, initialValue, mode])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const err = validateName(value, kind)
    if (err) return setError(err)
    if (value.trim() === initialValue) return onClose()
    setBusy(true)
    try {
      await onSubmit(value.trim())
      onClose()
    } catch (ex) {
      const res = (ex as { response?: { data?: { message?: string } } }).response?.data
      setError(res?.message ?? `Couldn’t save this ${kind} name.`)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'create-folder' ? 'New folder' : mode === 'rename-folder' ? 'Rename folder' : 'Rename file'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      title={title}
      initialFocusRef={inputRef as React.RefObject<HTMLElement>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="name-dialog-form" loading={busy}>{mode === 'create-folder' ? 'Create folder' : 'Save'}</Button>
        </>
      }
    >
      <form id="name-dialog-form" onSubmit={submit} noValidate>
        <Field label={mode === 'create-folder' ? 'Folder name' : 'Name'} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={inputRef}
              id={id}
              value={value}
              onChange={(e) => { setValue(e.target.value); if (error) setError(null) }}
              placeholder={mode === 'create-folder' ? 'e.g. Contracts 2026' : undefined}
              aria-describedby={describedBy}
              invalid={invalid}
              autoComplete="off"
              maxLength={255}
              disabled={busy}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}

interface TreeRowCtx {
  target: string | null
  setTarget: (id: string) => void
  expanded: Set<string>
  toggle: (id: string) => void
  disabledIds?: Set<string>
  currentParentId: string | null
}

function TreeRow({ node, depth, ctx }: { node: FolderNode; depth: number; ctx: TreeRowCtx }) {
  const { target, setTarget, expanded, toggle, disabledIds, currentParentId } = ctx
  const disabled = disabledIds?.has(node.id) ?? false
  const hasChildren = node.children?.length > 0
  const isOpen = expanded.has(node.id)
  const selected = target === node.id
  return (
    <li role="none">
      <div
        className={cn('flex h-9 items-center gap-1 pr-2', selected ? 'bg-primary/10' : 'hover:bg-white/[0.03]', disabled && 'opacity-40')}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          type="button"
          className={cn('grid h-6 w-6 place-items-center rounded text-subtle hover:text-foreground', !hasChildren && 'invisible')}
          onClick={() => toggle(node.id)}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          tabIndex={hasChildren ? 0 : -1}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
        </button>
        <button
          type="button"
          role="treeitem"
          aria-selected={selected}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => setTarget(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-foreground disabled:cursor-not-allowed"
        >
          <FolderIcon size="sm" className="h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5" />
          <span className="truncate">{node.name}</span>
          {node.id === currentParentId && <span className="ml-auto shrink-0 text-2xs text-subtle">Current</span>}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">{node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} ctx={ctx} />)}</ul>
      )}
    </li>
  )
}

interface MoveDialogProps {
  open: boolean
  title: string
  tree: FolderNode[]
  /** Folder the items currently live in (null = root). */
  currentParentId: string | null
  /** Folder ids that cannot be chosen (e.g. the folder being moved and its descendants). */
  disabledIds?: Set<string>
  onClose: () => void
  onSubmit: (targetId: string | null) => Promise<void>
}

export function MoveDialog({ open, title, tree, currentParentId, disabledIds, onClose, onSubmit }: MoveDialogProps) {
  const [target, setTarget] = useState<string | null>(currentParentId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTarget(currentParentId)
    setError(null)
    setBusy(false)
    setExpanded(new Set(tree.map((n) => n.id)))
  }, [open, currentParentId, tree])

  const unchanged = target === currentParentId

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(target)
      onClose()
    } catch (ex) {
      const res = (ex as { response?: { data?: { message?: string } } }).response?.data
      setError(res?.message ?? 'Couldn’t move the selected items.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rootSelected = target === null
  const ctx: TreeRowCtx = { target, setTarget, expanded, toggle, disabledIds, currentParentId }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissible={!busy}
      title={title}
      description="Choose a destination folder."
      icon={<span className="grid h-9 w-9 place-items-center rounded bg-primary/10 text-primary"><FolderInput className="h-[18px] w-[18px]" /></span>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={unchanged}>Move here</Button>
        </>
      }
    >
      <ul role="tree" aria-label="Destination folders" className="max-h-[50svh] overflow-y-auto border border-border py-1">
        <li role="none">
          <button
            type="button"
            role="treeitem"
            aria-selected={rootSelected}
            onClick={() => setTarget(null)}
            className={cn('flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-semibold text-foreground', rootSelected ? 'bg-primary/10' : 'hover:bg-white/[0.03]')}
          >
            <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> My Files
            {currentParentId === null && <span className="ml-auto text-2xs font-normal text-subtle">Current</span>}
          </button>
        </li>
        {tree.map((n) => <TreeRow key={n.id} node={n} depth={0} ctx={ctx} />)}
      </ul>
      {tree.length === 0 && <p className="mt-3 text-xs text-muted-foreground">You don’t have any folders yet. Create one first to organize files.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-[#ff7b70]">{error}</p>}
    </Dialog>
  )
}
