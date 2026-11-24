import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Quote, RefreshCw, Sparkles } from 'lucide-react'
import { Dialog } from '@components/ui/Dialog'
import { Button } from '@components/ui/Button'
import { Badge, ErrorState, Skeleton } from '@components/ui/primitives'
import { useToast } from '@components/ui/Toast'
import { aiApi, isProviderUnavailable, type AiCapabilities, type AiDocument, type Passage } from '@services/ai'
import { formatDateTime, getErrorMessage } from '@lib/format'
import { AiStatusBadge, aiStatusHint } from './AiStatusBadge'

export interface InsightsTarget {
  id: string
  filename: string
  /** Optional passage (from a citation or search hit) to show first. */
  chunkIndex?: number
}

const PREVIEW_CHARS = 4000

export function DocumentInsightsDialog({ target, onClose, onStatusChange }: {
  target: InsightsTarget | null
  onClose: () => void
  /** Called when indexing state changes so lists can refresh their badges. */
  onStatusChange?: () => void
}) {
  const toast = useToast()
  const [caps, setCaps] = useState<AiCapabilities | null>(null)
  const [doc, setDoc] = useState<AiDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState<{ text: string; total: number; truncated: boolean } | null>(null)
  const [passage, setPassage] = useState<Passage | null>(null)
  const [busy, setBusy] = useState<'reindex' | 'summary' | 'more' | null>(null)
  const lastStatus = useRef<string | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  const fileId = target?.id

  const load = useCallback(async () => {
    if (!fileId) return
    try {
      const [c, d] = await Promise.all([aiApi.status(), aiApi.document(fileId)])
      setCaps(c)
      setDoc(d)
      setError(null)
      if (lastStatus.current && lastStatus.current !== d.status) onStatusChangeRef.current?.()
      lastStatus.current = d.status
      if (d.status === 'ready') {
        const t = await aiApi.text(fileId, 0, PREVIEW_CHARS).catch(() => null)
        setText(t ? { text: t.text, total: t.totalLength, truncated: t.truncatedAtExtraction } : null)
      } else {
        setText(null)
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Couldn’t load document insights.'))
    }
  }, [fileId])

  useEffect(() => {
    setDoc(null); setText(null); setPassage(null); setError(null); lastStatus.current = null
    if (!fileId) return
    load()
    if (target?.chunkIndex !== undefined) {
      aiApi.passage(fileId, target.chunkIndex).then(setPassage).catch(() => setPassage(null))
    }
  }, [fileId, target?.chunkIndex, load])

  // Poll while work is in progress.
  useEffect(() => {
    if (!doc || (doc.status !== 'pending' && doc.status !== 'processing')) return
    const t = window.setTimeout(load, 2500)
    return () => window.clearTimeout(t)
  }, [doc, load])

  const reindex = async () => {
    if (!fileId) return
    setBusy('reindex')
    try {
      await aiApi.reindex(fileId)
      toast.success('Indexing queued', 'The document will be processed in the background.')
      onStatusChangeRef.current?.()
      await load()
    } catch (err) {
      toast.error('Couldn’t start indexing', getErrorMessage(err, 'Please try again.'))
    } finally { setBusy(null) }
  }

  const summarize = async () => {
    if (!fileId) return
    setBusy('summary')
    try {
      await aiApi.summarize(fileId)
      await load()
    } catch (err) {
      toast.error(isProviderUnavailable(err) ? 'Summaries aren’t available' : 'Couldn’t summarize', getErrorMessage(err, 'Please try again.'))
      await load()
    } finally { setBusy(null) }
  }

  const loadMore = async () => {
    if (!fileId || !text) return
    setBusy('more')
    try {
      const next = await aiApi.text(fileId, text.text.length, PREVIEW_CHARS * 2)
      setText({ ...text, text: text.text + next.text })
    } catch (err) {
      toast.error('Couldn’t load more text', getErrorMessage(err, 'Please try again.'))
    } finally { setBusy(null) }
  }

  const aiOff = caps && !caps.enabled
  const status = doc?.status

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      size="lg"
      title="Document insights"
      description={<span className="break-all">{target?.filename}</span>}
      icon={<Sparkles className="h-5 w-5" />}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {error ? (
        <ErrorState title="Couldn’t load insights" message={error} onRetry={load} className="py-8" />
      ) : !doc || !caps ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading insights"><Skeleton className="h-5 w-40" /><Skeleton className="h-20 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="space-y-5">
          {/* Status */}
          <section aria-labelledby="ins-status" className="flex flex-wrap items-start justify-between gap-3 border border-border bg-surface-sunken p-3">
            <div className="min-w-0">
              <h3 id="ins-status" className="flex items-center gap-2 text-sm font-semibold text-foreground">AI status <AiStatusBadge status={statusToRaw(status)} showAll /></h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {aiOff
                  ? 'AI features are not configured on this server. Your file is stored and shareable as usual.'
                  : doc.error
                    ? doc.error.message
                    : status === 'ready'
                      ? `${doc.chunkCount} passages indexed${doc.extraction?.pageCount ? ` from ${doc.extraction.pageCount} pages` : ''}${doc.indexedAt ? ` · ${formatDateTime(doc.indexedAt)}` : ''}`
                      : status ? aiStatusHint(status) : ''}
                {doc.job?.status === 'queued' && doc.job.attempts > 0 && doc.job.nextAttemptAt && (
                  <> Retrying (attempt {doc.job.attempts + 1} of {doc.job.maxAttempts}) after a temporary error.</>
                )}
              </p>
            </div>
            {doc.canReindex && caps.features.indexing && doc.supported && status !== 'pending' && status !== 'processing' && (
              <Button size="sm" variant="secondary" onClick={reindex} loading={busy === 'reindex'}>
                {busy !== 'reindex' && <RefreshCw className="h-4 w-4" />} {status === 'ready' ? 'Re-index' : status === 'not_indexed' ? 'Index now' : 'Retry'}
              </Button>
            )}
          </section>

          {!doc.supported && (
            <p className="text-sm text-muted-foreground">AI indexing supports PDF, Word (.docx), Markdown and plain-text files.</p>
          )}

          {/* Cited passage */}
          {passage && (
            <section aria-labelledby="ins-passage">
              <h3 id="ins-passage" className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Quote className="h-4 w-4 text-primary" aria-hidden="true" /> Cited passage
                {passage.pageStart != null && <Badge>Page {passage.pageStart}{passage.pageEnd && passage.pageEnd !== passage.pageStart ? `–${passage.pageEnd}` : ''}</Badge>}
              </h3>
              <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-primary bg-primary/[0.05] p-3 text-sm text-foreground">{passage.content}</blockquote>
            </section>
          )}

          {/* Summary */}
          {status === 'ready' && (
            <section aria-labelledby="ins-summary">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="ins-summary" className="text-sm font-semibold text-foreground">Summary</h3>
                {doc.canReindex && caps.features.summaries && (
                  <Button size="xs" variant="ghost" onClick={summarize} loading={busy === 'summary'}>
                    {doc.summary.status === 'ready' ? 'Regenerate' : 'Generate summary'}
                  </Button>
                )}
              </div>
              {doc.summary.status === 'ready' && doc.summary.text ? (
                <div className="border border-border p-3">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{doc.summary.text}</p>
                  <p className="mt-2 text-2xs text-subtle">
                    AI-generated from the document’s text{doc.summary.coverage != null && doc.summary.coverage < 1 ? ` (based on about ${Math.round(doc.summary.coverage * 100)}% of a long document)` : ''}. Verify important details against the source.
                  </p>
                </div>
              ) : !caps.features.summaries ? (
                <p className="text-sm text-muted-foreground">Summaries need a text-generation provider, which isn’t configured on this server.</p>
              ) : doc.summary.status === 'failed' ? (
                <p className="text-sm text-[#ff7b70]">The summary couldn’t be generated: {doc.summary.error}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No summary yet.</p>
              )}
            </section>
          )}

          {/* Extracted text */}
          {status === 'ready' && (
            <section aria-labelledby="ins-text">
              <h3 id="ins-text" className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Extracted text
                {text && <span className="text-xs font-normal text-muted-foreground">{text.total.toLocaleString()} characters{text.truncated ? ' (document was truncated at the processing limit)' : ''}</span>}
              </h3>
              {text ? (
                <>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border border-border bg-surface-sunken p-3 font-sans text-xs leading-5 text-muted-foreground">{text.text}</pre>
                  {text.text.length < text.total && (
                    <Button size="xs" variant="ghost" className="mt-2" onClick={loadMore} loading={busy === 'more'}>Show more</Button>
                  )}
                </>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </section>
          )}

          {caps.privacy.sendsDocumentsToThirdParty && (
            <p className="text-2xs text-subtle">Privacy: document text is sent to an external AI provider ({caps.privacy.externalProviders.join(', ')}) for indexing and answers.</p>
          )}
        </div>
      )}
    </Dialog>
  )
}

const statusToRaw = (s?: string) =>
  ({ ready: 'INDEXED', pending: 'PENDING', processing: 'PROCESSING', failed: 'FAILED', unsupported: 'UNSUPPORTED', not_indexed: 'NA' })[s ?? 'not_indexed']
