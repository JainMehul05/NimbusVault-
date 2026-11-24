import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { FolderNode } from '@services/files'
import { cn } from '@lib/utils'
import { folderHref } from './Breadcrumb'

interface FolderTreeProps {
  tree: FolderNode[]
  currentFolderId: string | null
  /** Ancestors of the current folder; auto-expanded so the active node is visible. */
  activePath: FolderNode[]
}

function Node({ node, depth, currentFolderId, expanded, toggle }: {
  node: FolderNode
  depth: number
  currentFolderId: string | null
  expanded: Set<string>
  toggle: (id: string) => void
}) {
  const hasChildren = node.children?.length > 0
  const open = expanded.has(node.id)
  const active = node.id === currentFolderId
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={active}>
      <div
        className={cn('group flex h-8 items-center rounded pr-2 transition-colors', active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground')}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => toggle(node.id)}
          className={cn('grid h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:text-foreground', !hasChildren && 'invisible')}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          tabIndex={hasChildren ? 0 : -1}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-fast', open && 'rotate-90')} />
        </button>
        <Link to={folderHref(node.id)} className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-current={active ? 'page' : undefined}>
          {active || open ? <FolderOpen className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : '')} aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="truncate">{node.name}</span>
        </Link>
      </div>
      {hasChildren && open && (
        <ul role="group">
          {node.children.map((c) => <Node key={c.id} node={c} depth={depth + 1} currentFolderId={currentFolderId} expanded={expanded} toggle={toggle} />)}
        </ul>
      )}
    </li>
  )
}

/** Compact, navigable folder hierarchy for the file manager side column. */
export function FolderTree({ tree, currentFolderId, activePath }: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activePath.length) return
    setExpanded((prev) => {
      const next = new Set(prev)
      activePath.forEach((n) => next.add(n.id))
      return next
    })
  }, [activePath])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (!tree.length) return <p className="px-2 py-1 text-xs text-subtle">No folders yet.</p>

  return (
    <ul role="tree" aria-label="Folders" className="space-y-px">
      {tree.map((n) => <Node key={n.id} node={n} depth={0} currentFolderId={currentFolderId} expanded={expanded} toggle={toggle} />)}
    </ul>
  )
}
