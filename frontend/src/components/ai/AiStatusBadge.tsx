import { AlertTriangle, CircleDashed, Loader2, Sparkles, Ban } from 'lucide-react'
import { Badge } from '@components/ui/primitives'
import { toAiStatus, type AiFileStatus } from '@services/ai'

const META: Record<AiFileStatus, { label: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'; icon: typeof Sparkles; hint: string }> = {
  ready: { label: 'AI ready', tone: 'success', icon: Sparkles, hint: 'Indexed for semantic search and questions' },
  pending: { label: 'Queued', tone: 'info', icon: CircleDashed, hint: 'Waiting to be indexed' },
  processing: { label: 'Indexing', tone: 'info', icon: Loader2, hint: 'Extracting text and building the search index' },
  failed: { label: 'AI failed', tone: 'danger', icon: AlertTriangle, hint: 'Indexing failed — open Document insights to retry' },
  unsupported: { label: 'No AI', tone: 'neutral', icon: Ban, hint: 'This file can’t be indexed (type, size, or scanned without text)' },
  not_indexed: { label: 'Not indexed', tone: 'neutral', icon: CircleDashed, hint: 'Not yet indexed for AI' },
}

/** Compact AI indexing state. Hidden for files AI never applies to unless `showAll`. */
export function AiStatusBadge({ status, showAll = false }: { status?: string | null; showAll?: boolean }) {
  const s = toAiStatus(status)
  if (!showAll && (s === 'not_indexed' || s === 'unsupported')) return null
  const m = META[s]
  return (
    <span title={m.hint} className="inline-flex">
      <Badge tone={m.tone} icon={m.icon} className={s === 'processing' ? '[&_svg]:animate-spin' : undefined}>
        {m.label}
      </Badge>
    </span>
  )
}

export const aiStatusHint = (status: AiFileStatus) => META[status].hint
