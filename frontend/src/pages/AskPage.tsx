import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, FileSearch, Info, MessageSquareText, Search, SearchX, Sparkles } from 'lucide-react'
import { AppShell } from '@components/layout/AppShell'
import { Button } from '@components/ui/Button'
import { Input } from '@components/ui/Input'
import { Badge, EmptyState, ErrorState, RoleBadge, Skeleton } from '@components/ui/primitives'
import { FileTypeIcon } from '@components/files/FileTypeIcon'
import { DocumentInsightsDialog, type InsightsTarget } from '@components/ai/DocumentInsightsDialog'
import { aiApi, errorCode, type AiCapabilities, type AnswerResult, type Citation, type SearchResult } from '@services/ai'
import { getErrorMessage } from '@lib/format'
import { cn } from '@lib/utils'
import { useSearchParams } from 'react-router-dom'
import { foldersApi, flattenTree, type FolderNode } from '@services/files'

type Tab = 'ask' | 'search'

interface Turn {
  id: number
  question: string
  state: 'loading' | 'done' | 'error'
  result?: AnswerResult
  error?: string
}

const pages = (r: { pageStart: number | null; pageEnd: number | null }) =>
  r.pageStart == null ? null : r.pageEnd != null && r.pageEnd !== r.pageStart ? `pp. ${r.pageStart}–${r.pageEnd}` : `p. ${r.pageStart}`

/** Renders an answer, turning [S1] markers into buttons that open the cited passage. */
function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const byRef = new Map(citations.map((c) => [c.ref, c]))
  const parts: ReactNode[] = []
  text.split(/(\[S\d{1,3}\])/g).forEach((part, i) => {
    const m = part.match(/^\[(S\d{1,3})\]$/)
    const c = m ? byRef.get(m[1]) : undefined
    if (c) {
      parts.push(
        <button
          key={i}
          type="button"
          onClick={() => onOpen(c)}
          className="mx-0.5 inline-flex h-5 items-center rounded-sm border border-primary/40 bg-primary/10 px-1 align-baseline text-2xs font-bold text-primary hover:bg-primary/20"
          aria-label={`Source ${c.ref}: ${c.filename}${pages(c) ? `, ${pages(c)}` : ''}`}
        >
          {c.ref}
        </button>
      )
    } else if (!m) {
      parts.push(<span key={i}>{part}</span>)
    }
  })
  return <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{parts}</p>
}

function SourceCard({ r, label, onOpen }: { r: SearchResult; label?: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex w-full gap-3 border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-white/[0.02]">
        <FileTypeIcon filename={r.filename} mimeType={r.mimeType} category="" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {label && <Badge tone="brand">{label}</Badge>}
            <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{r.filename}</span>
            {pages(r) && <span className="text-xs text-muted-foreground">{pages(r)}</span>}
            {r.permission !== 'OWNER' && <RoleBadge role={r.permission} />}
          </span>
          <span className="mt-1 line-clamp-3 block text-xs leading-5 text-muted-foreground">{r.snippet}</span>
        </span>
        <span className="shrink-0 self-start text-2xs tabular-nums text-subtle" title="Similarity score">{Math.round(r.score * 100)}%</span>
      </button>
    </li>
  )
}

export function AskPage() {
  const [params]=useSearchParams()
  const selectedFileId=params.get('fileId')
  const [folderId,setFolderId]=useState(params.get('folderId') ?? '')
  const [category,setCategory]=useState('')
  const [folders,setFolders]=useState<FolderNode[]>([])
  const [scopeError,setScopeError]=useState<string | null>(null)
  const [caps, setCaps] = useState<AiCapabilities | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('ask')
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; results: SearchResult[]; error?: string; query?: string;retrievalMs?:number }>({ state: 'idle', results: [] })
  const [insights, setInsights] = useState<InsightsTarget | null>(null)
  const seq = useRef(0)
  const request = useRef<string | null>(null)
  const [conversationId, setConversationId] = useState<string>()
  const [history, setHistory] = useState<Array<{id:string;title:string}>>([])
  const [mode, setMode] = useState('hybrid')
  const [stopError,setStopError]=useState<string | null>(null)
  useEffect(() => {setConversationId(undefined);setTurns([]);setSearch({state:'idle',results:[]})},[selectedFileId,folderId])
  useEffect(() => {if(params.get('task')==='summary')setQuestion('Summarize the important takeaways from the selected document’s retrieved excerpts. Do not claim full-document coverage.')},[params])
  const continueConversation = async (id: string) => {
    setConversationId(id || undefined)
    if (!id) { setTurns([]); return }
    try {
      const detail = await aiApi.conversation(id)
      setTurns(detail.exchanges.map(e => ({id:++seq.current,question:e.question,state:'done' as const,result:e.response})).reverse())
    } catch { setTurns([]); setCapsError('This history is unavailable or access to its documents has changed.') }
  }

  const loadCaps = () => {
    setCapsError(null)
    aiApi.status().then(setCaps).catch((err) => setCapsError(getErrorMessage(err, 'Couldn’t check AI availability.')))
  }
  useEffect(loadCaps, [])

  const canAsk = !!caps?.features.questionAnswering
  const canSearch = !!caps?.features.semanticSearch
  useEffect(() => { if (caps && !canAsk && canSearch) setTab('search') }, [caps, canAsk, canSearch])

  const submitQuestion = async (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 3) return
    const id = ++seq.current
    setStopError(null)
    setTurns((prev) => [{ id, question: q, state: 'loading' as const }, ...prev].slice(0, 20))
    setQuestion('')
    try {
      const requestId = crypto.randomUUID()
      request.current = requestId
      const result = await aiApi.ask(q, { conversationId, requestId, ...(selectedFileId ? {fileIds:[selectedFileId]} : {}),...(folderId?{folderId}:{}) })
      setConversationId(result.conversationId)
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, state: 'done', result } : t)))
    } catch (err) {
      const msg = errorCode(err) === 'RATE_LIMIT_EXCEEDED' || errorCode(err) === 'AI_BUSY'
        ? getErrorMessage(err, 'Too many questions — please wait a moment.')
        : getErrorMessage(err, 'The assistant couldn’t answer right now.')
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, state: 'error', error: msg } : t)))
    } finally { request.current = null }
  }

  const submitSearch = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setSearch({ state: 'loading', results: [], query: q })
    try {
      const { results,retrievalMs } = await aiApi.search(q, { limit: 10, mode, ...(selectedFileId ? {fileIds:[selectedFileId]} : {}),...(folderId?{folderId}:{}),...(category?{category}:{}) })
      setSearch({ state: 'done', results, query: q,retrievalMs })
    } catch (err) {
      setSearch({ state: 'error', results: [], error: getErrorMessage(err, 'Search failed.'), query: q })
    }
  }

  const open = (r: SearchResult) => setInsights({ id: r.fileId, filename: r.filename, chunkIndex: r.chunkIndex })

  const tabs = useMemo(() => [
    { id: 'ask' as const, label: 'Ask a question', icon: MessageSquareText, enabled: canAsk },
    { id: 'search' as const, label: 'Semantic search', icon: FileSearch, enabled: canSearch },
  ], [canAsk, canSearch])

  return (
    <AppShell title="Ask NimbusVault" description="Search and ask questions across the documents you can access — answers cite their sources.">
      {capsError ? (
        <div className="border border-border bg-surface"><ErrorState title="Couldn’t check AI availability" message={capsError} onRetry={loadCaps} /></div>
      ) : !caps ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading"><Skeleton className="h-10 w-72" /><Skeleton className="h-28 w-full" /></div>
      ) : !caps.enabled ? (
        <div className="border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={Sparkles}
            title="AI features aren’t configured"
            description="This NimbusVault server has no AI provider set up, so document indexing, semantic search and questions are unavailable. Storage and sharing work normally. An administrator can enable AI in the server configuration."
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge tone="brand">Local retrieval</Badge><span>MiniLM · Qwen2.5 3B · no hosted AI</span>{selectedFileId && <Badge tone="brand">Selected document only</Badge>}
            <select aria-label="Document folder scope" value={folderId} disabled={turns.some(t=>t.state==='loading')} onFocus={()=>{if(!folders.length)void foldersApi.tree().then(tree=>{setFolders(flattenTree(tree));setScopeError(null)}).catch(()=>setScopeError('Folder list unavailable; current scope is unchanged.'))}} onChange={e=>setFolderId(e.target.value)} className="max-w-full border border-border bg-surface p-2"><option value="">All accessible folders</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
            {scopeError && <span role="status">{scopeError}</span>}
            <Button variant="secondary" onClick={() => { setConversationId(undefined); setTurns([]) }}>New conversation</Button>
            <Button variant="secondary" onClick={() => aiApi.conversations().then(setHistory).catch(() => setCapsError('Conversation history is unavailable.'))}>History</Button>
            {history.length > 0 && <select aria-label="Continue conversation" value={conversationId ?? ''} onChange={(e) => { void continueConversation(e.target.value) }} className="max-w-full border border-border bg-surface p-2"><option value="">New conversation</option>{history.map(h => <option key={h.id} value={h.id}>{h.title}</option>)}</select>}
          </div>
          <div role="tablist" aria-label="AI tools" className="mb-5 flex border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`ai-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`ai-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn('-mb-px flex h-10 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors', tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
              >
                <t.icon className="h-4 w-4" aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'ask' ? (
            <section id="ai-panel-ask" role="tabpanel" aria-labelledby="ai-tab-ask">
              {!canAsk ? (
                <div className="border border-border bg-surface">
                  <EmptyState icon={Info} title="Question answering isn’t available" description="Semantic search works, but this server has no text-generation provider configured for answers. Use the Semantic search tab instead." action={<Button variant="secondary" onClick={() => setTab('search')}>Go to search</Button>} />
                </div>
              ) : (
                <>
                  <form onSubmit={submitQuestion} className="border border-border bg-surface p-3 sm:p-4">
                    <label htmlFor="ask-input" className="mb-2 block text-sm font-semibold text-foreground">Your question</label>
                    <textarea
                      id="ask-input"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
                      maxLength={1000}
                      rows={3}
                      placeholder="e.g. What is the hotel reimbursement limit in the travel policy?"
                      className="w-full resize-y rounded border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-subtle">Answers use only documents you can access. {question.length}/1000</p>
                      <Button type="submit" disabled={question.trim().length < 3 || turns.some((t) => t.state === 'loading')}>
                        <Sparkles className="h-4 w-4" /> Ask
                      </Button>
                      {turns.some(t => t.state === 'loading') && <Button type="button" variant="secondary" onClick={() => { if(request.current) void aiApi.cancel(request.current).catch(()=>setStopError('Stop could not be delivered. Please retry.')) }}>Stop</Button>}
                    </div>
                    {stopError && <p role="alert" className="mt-2 text-xs text-warning">{stopError}</p>}
                  </form>

                  <div className="mt-5 space-y-4" aria-live="polite">
                    {turns.length === 0 && (
                      <p className="text-sm text-muted-foreground">Ask about the contents of your indexed documents. Each answer links to the passages it’s based on, and says so when your documents don’t contain the answer.</p>
                    )}
                    {turns.map((t) => (
                      <article key={t.id} className="border border-border bg-surface">
                        <header className="border-b border-border px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Question</p>
                          <p className="mt-1 text-sm text-foreground">{t.question}</p>
                        </header>
                        <div className="px-4 py-4">
                          {t.state === 'loading' ? (
                            <div className="space-y-2" aria-label="Thinking" aria-busy="true"><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /><Skeleton className="h-3 w-2/3" /></div>
                          ) : t.state === 'error' ? (
                            <p role="alert" className="flex items-start gap-2 text-sm text-[#ff7b70]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {t.error}</p>
                          ) : t.result!.status === 'insufficient_evidence' ? (
                            <div className="flex items-start gap-3">
                              <SearchX className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                              <div>
                                <p className="text-sm font-semibold text-foreground">Not enough evidence in your documents</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {t.result!.answer || (t.result!.sourcesConsidered === 0
                                    ? 'No indexed document you can access appears related to this question.'
                                    : 'The most relevant passages don’t answer this question.')}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <>
                              {t.result!.status === 'ungrounded' && (
                                <p className="mb-3 flex items-start gap-2 border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> This answer didn’t cite any source, so it may not be supported by your documents. Treat it with caution.
                                </p>
                              )}
                              <AnswerText text={t.result!.answer ?? ''} citations={t.result!.citations} onOpen={open} />
                              {t.result!.citations.length > 0 && (
                                <>
                                  <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Sources</h3>
                                  <ul className="space-y-2">{t.result!.citations.map((c) => <SourceCard key={c.ref} r={c} label={c.ref} onOpen={() => open(c)} />)}</ul>
                                </>
                              )}
                              {t.result!.warning && <p className="mt-3 text-xs text-warning">{t.result!.warning}</p>}
                              <p className="mt-3 text-2xs text-subtle">{t.result!.mode === 'extractive' ? 'Cited excerpts · extractive fallback' : 'AI-generated from your documents'}{t.result!.model ? ` · ${t.result!.model}` : ''}. Check cited passages for important decisions.</p>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : (
            <section id="ai-panel-search" role="tabpanel" aria-labelledby="ai-tab-search">
              <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
                <select aria-label="Search mode" value={mode} onChange={e => setMode(e.target.value)} className="border border-border bg-surface p-2 text-sm text-foreground"><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option><option value="exact">Exact content</option><option value="filename">Filename</option></select>
                <select aria-label="Document type filter" value={category} onChange={e=>setCategory(e.target.value)} className="border border-border bg-surface p-2 text-sm"><option value="">All types</option><option value="pdf">PDF documents</option><option value="document">Text / Office documents</option><option value="image">Images</option><option value="other">Other</option></select>
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} placeholder="Describe what you’re looking for, in your own words" aria-label="Semantic search query" className="pl-9" />
                </div>
                <Button type="submit" disabled={query.trim().length < 2} loading={search.state === 'loading'}>Search</Button>
              </form>
              <p className="mt-2 text-xs text-subtle">{mode==='hybrid'?'Hybrid combines meaning and keyword evidence.':mode==='semantic'?'Semantic ranks by meaning.':mode==='exact'?'Exact content finds a literal phrase.':'Filename searches current document names.'} Searches only indexed documents you can access.</p>
              {search.state==='done' && <p role="status" className="mt-2 text-xs text-muted-foreground">{search.results.length} matching documents{search.retrievalMs!=null?` · ${search.retrievalMs} ms on the local server`:''}</p>}

              <div className="mt-5" aria-live="polite">
                {search.state === 'loading' ? (
                  <div className="space-y-2" aria-busy="true">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : search.state === 'error' ? (
                  <div className="border border-border bg-surface"><ErrorState title="Search failed" message={search.error} /></div>
                ) : search.state === 'done' && search.results.length === 0 ? (
                  <div className="border border-border bg-surface">
                    <EmptyState icon={SearchX} title={`No relevant passages for “${search.query}”`} description="Try different wording. Only indexed documents (marked “AI ready”) are searchable." />
                  </div>
                ) : search.state === 'done' ? (
                  <ul className="space-y-2">{search.results.map((r) => <SourceCard key={r.chunkId} r={r} onOpen={() => open(r)} />)}</ul>
                ) : null}
              </div>
            </section>
          )}

          {caps.privacy.sendsDocumentsToThirdParty && (
            <p className="mt-6 flex items-start gap-2 text-xs text-subtle"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Privacy: relevant document passages are sent to an external AI provider ({caps.privacy.externalProviders.join(', ')}) to generate answers.</p>
          )}
        </>
      )}
      <DocumentInsightsDialog target={insights} onClose={() => setInsights(null)} />
    </AppShell>
  )
}
