import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, HardDrive } from 'lucide-react'
import type { FolderNode } from '@services/files'
import { cn } from '@lib/utils'

export const folderHref = (id: string | null) => (id ? `/files/${id}` : '/files')

/** My Files › … › Parent › Current. Middle levels collapse on long paths. */
export function Breadcrumb({ path }: { path: FolderNode[] }) {
  const items: Array<{ id: string | null; name: string } | 'ellipsis'> = [{ id: null, name: 'My Files' }]
  if (path.length > 3) items.push('ellipsis', ...path.slice(-2))
  else items.push(...path)
  const hidden = path.length > 3 ? path.slice(0, -2) : []

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <Fragment key={item === 'ellipsis' ? 'ellipsis' : item.id ?? 'root'}>
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
              <li className="min-w-0">
                {item === 'ellipsis' ? (
                  <span className="px-1 text-subtle" title={hidden.map((h) => h.name).join(' / ')}>…</span>
                ) : last ? (
                  <span aria-current="page" className="flex min-w-0 items-center gap-1.5 px-1 font-semibold text-foreground">
                    {item.id === null && <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span className="max-w-[220px] truncate">{item.name}</span>
                  </span>
                ) : (
                  <Link
                    to={folderHref(item.id)}
                    className={cn('flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground')}
                  >
                    {item.id === null && <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span className="max-w-[160px] truncate">{item.name}</span>
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
