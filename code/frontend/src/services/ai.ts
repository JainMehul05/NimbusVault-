import { api, type ApiResponse } from './api';

export type AiFileStatus = 'not_indexed' | 'pending' | 'processing' | 'ready' | 'failed' | 'unsupported';
/** Raw enum stored on file records. */
export type AiStatusRaw = 'NA' | 'PENDING' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'UNSUPPORTED';

export const AI_SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

export const toAiStatus = (raw?: string | null): AiFileStatus =>
  (({ NA: 'not_indexed', PENDING: 'pending', PROCESSING: 'processing', INDEXED: 'ready', FAILED: 'failed', UNSUPPORTED: 'unsupported' }) as Record<string, AiFileStatus>)[
    raw ?? 'NA'
  ] ?? 'not_indexed';

export interface AiCapabilities {
  enabled: boolean;
  embedding: { configured: boolean; provider: string | null; model: string | null; dimensions: number | null };
  generation: { configured: boolean; provider: string | null; model: string | null };
  features: { indexing: boolean; semanticSearch: boolean; summaries: boolean; questionAnswering: boolean; ocr: boolean };
  worker: { running: boolean; concurrency: number };
  limits: { maxFileBytes: number; maxPdfPages: number; maxExtractedChars: number; queriesPerWindow: number; queryWindowMs: number };
  supportedMimeTypes: string[];
  privacy: { sendsDocumentsToThirdParty: boolean; externalProviders: string[] };
  /** Present only when the server is configured for the external Groq provider. */
  providers?: { groq: { available: boolean; reason: string | null; retryAfter: number | null; external: true };
    local: { available: boolean; model: string | null; external: false } };
}

export interface AiDocument {
  fileId: string;
  filename: string;
  mimeType: string;
  status: AiFileStatus;
  supported: boolean;
  canReindex: boolean;
  error: { code: string; message: string | null } | null;
  extraction: { extractor: string | null; characters: number; truncated: boolean; pageCount: number | null } | null;
  chunkCount: number;
  embeddingModel: string | null;
  indexedAt: string | null;
  summary: {
    status: 'none' | 'ready' | 'failed' | 'unavailable';
    text: string | null;
    model: string | null;
    coverage: number | null;
    generatedAt: string | null;
    error: string | null;
  };
  job: { status: string; attempts: number; maxAttempts: number; nextAttemptAt: string | null; lastError: string | null } | null;
}

export interface SearchResult {
  scoreKind?: 'cosine' | 'lexical' | 'literal';
  chunkId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  folderId: string | null;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  snippet: string;
  score: number;
  permission: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export interface Citation extends SearchResult {
  ref: string;
}

export interface AnswerResult {
  mode?: 'generated' | 'extractive' | 'insufficient';
  warning?: string | null;
  conversationId?: string;
  status: 'answered' | 'insufficient_evidence' | 'ungrounded';
  answer: string | null;
  citations: Citation[];
  sourcesConsidered: number;
  model: string | null;
  /** Which runtime actually generated the answer; null for excerpts. */
  provider?: 'groq' | 'ollama' | null;
  external?: boolean;
  providerError?: { code: string; retry_after?: number | null } | null;
}

export interface Passage {
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
}

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>) => p.then((r) => r.data.data as T);


/**
 * Answers are prepared as a background job and polled, so slow CPU inference is never cut off by
 * CloudFront or proxy time limits. Falls back to the synchronous endpoint on older servers.
 */
// Fast providers answer in under a second: poll quickly at first, then back off to 2 s.
const ASK_POLL_STEPS_MS = [400, 800, 1500, 2000]
const ASK_MAX_WAIT_MS = 10 * 60 * 1000
async function askAsync(body: Record<string, unknown>): Promise<AnswerResult> {
  let jobId: string
  try {
    const started = await api.post('/ai/ask/async', body)
    jobId = started.data.data.jobId
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) return data<AnswerResult>(api.post('/ai/ask', body))
    throw error
  }
  const deadline = Date.now() + ASK_MAX_WAIT_MS
  let polls = 0
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ASK_POLL_STEPS_MS[Math.min(polls++, ASK_POLL_STEPS_MS.length - 1)]))
    const poll = await api.get(`/ai/ask/async/${jobId}`)
    const job = poll.data.data as { state: string; result?: AnswerResult; error?: { status: number; code: string; message: string } }
    if (job.state === 'done') return job.result as AnswerResult
    if (job.state === 'error') {
      // Shaped like an Axios error so existing error handling (cancellation 499, 409, 429) is unchanged.
      throw { response: { status: job.error?.status ?? 500, data: { success: false, message: job.error?.message, error: { code: job.error?.code } } } }
    }
  }
  throw { response: { status: 504, data: { success: false, message: 'The answer took too long. Try again or ask a narrower question.', error: { code: 'AI_TIMEOUT' } } } }
}

export const aiApi = {
  status: () => data<AiCapabilities>(api.get('/ai/status')),
  document: (fileId: string) => data<AiDocument>(api.get(`/ai/files/${fileId}`)),
  reindex: (fileId: string) => data<{ fileId: string; status: string }>(api.post(`/ai/files/${fileId}/index`)),
  text: (fileId: string, offset = 0, limit = 5000) =>
    data<{ text: string; offset: number; totalLength: number; truncatedAtExtraction: boolean }>(
      api.get(`/ai/files/${fileId}/text`, { params: { offset, limit } })
    ),
  passage: (fileId: string, chunkIndex: number) => data<Passage>(api.get(`/ai/files/${fileId}/chunks/${chunkIndex}`)),
  summarize: (fileId: string) => data<AiDocument['summary']>(api.post(`/ai/files/${fileId}/summary`)),
  search: (query: string, opts: { limit?: number; fileIds?: string[]; mode?: string;folderId?:string;category?:string } = {}) =>
    data<{ results: SearchResult[]; model: string;retrievalMs?:number;resultCount?:number }>(api.post('/ai/search', { query, ...opts })),
  ask: (question: string, opts: { fileIds?: string[]; conversationId?: string; requestId?: string;folderId?:string;provider?:'auto'|'local' } = {}) => askAsync({ question, ...opts }),
  preferences: () => data<{ externalAiConsent: boolean }>(api.get('/users/me/ai-preferences')),
  setPreferences: (externalAiConsent: boolean) => data<{ externalAiConsent: boolean }>(api.put('/users/me/ai-preferences', { externalAiConsent })),
  cancel: (requestId: string) => api.post('/ai/cancel', { requestId }),
  conversations: () => data<Array<{ id: string; title: string }>>(api.get('/ai/conversations')),
  conversation: (id: string) => data<{exchanges:Array<{question:string;response:AnswerResult}>}>(api.get(`/ai/conversations/${id}`)),
};

/** Error code from an Axios error, if any. */
export const errorCode = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;

export const isProviderUnavailable = (err: unknown) => errorCode(err) === 'AI_PROVIDER_UNAVAILABLE';
