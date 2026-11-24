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
  status: 'answered' | 'insufficient_evidence' | 'ungrounded';
  answer: string | null;
  citations: Citation[];
  sourcesConsidered: number;
  model: string | null;
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
  search: (query: string, opts: { limit?: number; fileIds?: string[] } = {}) =>
    data<{ results: SearchResult[]; model: string }>(api.post('/ai/search', { query, ...opts })),
  ask: (question: string, opts: { fileIds?: string[] } = {}) => data<AnswerResult>(api.post('/ai/ask', { question, ...opts })),
};

/** Error code from an Axios error, if any. */
export const errorCode = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;

export const isProviderUnavailable = (err: unknown) => errorCode(err) === 'AI_PROVIDER_UNAVAILABLE';
