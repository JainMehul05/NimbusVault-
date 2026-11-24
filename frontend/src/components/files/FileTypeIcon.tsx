import { Folder } from 'lucide-react'
import { getFileTypeMeta } from '@lib/format'
import { cn } from '@lib/utils'

const sizes = {
  sm: 'h-7 w-7 [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-12 w-12 [&_svg]:h-6 [&_svg]:w-6',
}

export function FileTypeIcon({ filename, mimeType = '', category = '', size = 'sm', className }: {
  filename: string
  mimeType?: string
  category?: string
  size?: keyof typeof sizes
  className?: string
}) {
  const meta = getFileTypeMeta(filename, mimeType, category)
  return (
    <span className={cn('grid shrink-0 place-items-center rounded', meta.tint, meta.tone, sizes[size], className)} title={meta.label}>
      <meta.icon aria-hidden="true" />
    </span>
  )
}

export function FolderIcon({ size = 'sm', className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded bg-primary/10 text-primary', sizes[size], className)}>
      <Folder aria-hidden="true" fill="currentColor" fillOpacity={0.18} />
    </span>
  )
}
