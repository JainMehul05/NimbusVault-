import { config } from '@config/index';
import { AppError, ErrorCodes } from '@common/errors';
import { authorizationService } from '@common/authorization';
import { AiProviderError, getEmbeddingProvider, getGenerationProvider } from './providers';
import { vectorStore, type ChunkHit } from './vector-store';
import { generationSemaphore } from './summary.service';
import {
  buildQuestionPrompt,
  extractCitations,
  INSUFFICIENT,
  QA_SYSTEM_PROMPT,
  stripInvalidCitations,
  type PromptSource,
} from './prompts';

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

export type AnswerStatus = 'answered' | 'insufficient_evidence' | 'ungrounded';

export interface AnswerResult {
  status: AnswerStatus;
  answer: string | null;
  citations: Citation[];
  sourcesConsidered: number;
  model: string | null;
}

const SNIPPET_CHARS = 320;

/** Snippet centred on the best keyword match, falling back to the chunk start. */
export function makeSnippet(content: string, query: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_CHARS) return flat;
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    at = lower.indexOf(w);
    if (at !== -1) break;
  }
  const start = at === -1 ? 0 : Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

const pagesLabel = (h: { pageStart: number | null; pageEnd: number | null }) =>
  h.pageStart == null ? null : h.pageEnd != null && h.pageEnd !== h.pageStart ? `${h.pageStart}-${h.pageEnd}` : String(h.pageStart);

export class RagService {
  private requireEmbedder() {
    const embedder = getEmbeddingProvider();
    if (!embedder) {
      throw AppError.serviceUnavailable('AI search is not configured on this server', ErrorCodes.AI_PROVIDER_UNAVAILABLE);
    }
    return embedder;
  }

  /**
   * Authorization is enforced twice: inside the vector query (only currently accessible files
   * are scanned) and again per returned file just before content leaves the server, so a share
   * revoked mid-request still cannot leak a snippet.
   */
  private async retrieve(userId: string, query: string, limit: number, fileIds?: string[]): Promise<Array<ChunkHit & { permission: SearchResult['permission'] }>> {
    const embedder = this.requireEmbedder();
    let queryVector: number[];
    try {
      [queryVector] = await embedder.embed([query]);
    } catch (err) {
      const msg = err instanceof AiProviderError ? err.message : 'Embedding failed';
      throw AppError.serviceUnavailable(`AI search is temporarily unavailable: ${msg}`, 'AI_PROVIDER_ERROR');
    }

    const hits = await vectorStore.search({
      userId,
      queryVector,
      modelId: embedder.modelId,
      limit,
      minScore: config.ai.embedding.minScore,
      fileIds,
    });

    const levels = new Map<string, SearchResult['permission'] | null>();
    for (const fileId of new Set(hits.map((h) => h.fileId))) {
      levels.set(fileId, await authorizationService.getEffectivePermissionLevel(userId, 'FILE', fileId));
    }
    return hits
      .filter((h) => levels.get(h.fileId))
      .map((h) => ({ ...h, permission: levels.get(h.fileId)! }));
  }

  private toResult(h: ChunkHit & { permission: SearchResult['permission'] }, query: string): SearchResult {
    return {
      chunkId: h.chunkId,
      fileId: h.fileId,
      filename: h.filename,
      mimeType: h.mimeType,
      // Only the owner navigates by folder; collaborators reach files via "Shared with me".
      folderId: h.permission === 'OWNER' ? h.folderId : null,
      chunkIndex: h.chunkIndex,
      pageStart: h.pageStart,
      pageEnd: h.pageEnd,
      snippet: makeSnippet(h.content, query),
      score: Math.round(h.score * 1000) / 1000,
      permission: h.permission,
    };
  }

  async search(userId: string, query: string, options: { limit: number; fileIds?: string[] }): Promise<{ results: SearchResult[]; model: string }> {
    const embedder = this.requireEmbedder();
    const hits = await this.retrieve(userId, query, options.limit, options.fileIds);
    return { results: hits.map((h) => this.toResult(h, query)), model: embedder.model };
  }

  /**
   * Grounded Q&A. Retrieves authorized chunks, answers strictly from them, and validates the
   * model's citations against the sources actually supplied. When nothing relevant is found the
   * model is not called at all (no cost, no chance to hallucinate).
   */
  async ask(userId: string, question: string, options: { fileIds?: string[]; topK: number }): Promise<AnswerResult> {
    const generator = getGenerationProvider();
    if (!generator) {
      throw AppError.serviceUnavailable('AI question answering is not configured on this server', ErrorCodes.AI_PROVIDER_UNAVAILABLE);
    }

    const hits = await this.retrieve(userId, question, options.topK, options.fileIds);
    if (hits.length === 0) {
      return { status: 'insufficient_evidence', answer: null, citations: [], sourcesConsidered: 0, model: null };
    }

    // Fit sources into the context budget, most relevant first.
    const budget = config.ai.limits.maxContextChars;
    const selected: typeof hits = [];
    let used = 0;
    for (const h of hits) {
      if (used + h.content.length > budget && selected.length > 0) break;
      selected.push(h);
      used += Math.min(h.content.length, budget);
    }
    const sources: PromptSource[] = selected.map((h, i) => ({
      ref: `S${i + 1}`,
      filename: h.filename,
      pages: pagesLabel(h),
      content: h.content.slice(0, budget),
    }));

    let text: string;
    let model: string;
    try {
      const out = await generationSemaphore.run(() =>
        generator.generate({
          system: QA_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildQuestionPrompt(question, sources) }],
          maxTokens: config.ai.generation.maxOutputTokens,
          temperature: 0,
        })
      );
      text = out.text.trim();
      model = `${generator.name}:${out.model}`;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const msg = err instanceof AiProviderError ? err.message : 'Generation failed';
      throw AppError.serviceUnavailable(`The AI assistant is temporarily unavailable: ${msg}`, 'AI_PROVIDER_ERROR');
    }

    // Generation takes seconds. If access to any source was lost meanwhile (revoked share,
    // deleted file), the answer may contain its content and must not be returned.
    for (const fileId of new Set(selected.map((h) => h.fileId))) {
      if (!(await authorizationService.getEffectivePermissionLevel(userId, 'FILE', fileId))) {
        throw AppError.conflict('Access to a source document changed while answering. Please ask again.', 'SOURCES_CHANGED');
      }
    }

    const validRefs = new Set(sources.map((s) => s.ref));
    if (!text || text.toUpperCase().startsWith(INSUFFICIENT)) {
      const explanation = text.slice(INSUFFICIENT.length).trim();
      return {
        status: 'insufficient_evidence',
        answer: explanation || null,
        citations: [],
        sourcesConsidered: sources.length,
        model,
      };
    }

    const cleaned = stripInvalidCitations(text, validRefs).replace(/[ \t]{2,}/g, ' ').trim();
    const refs = extractCitations(cleaned, validRefs);
    const citations: Citation[] = refs.map((ref) => {
      const hit = selected[Number(ref.slice(1)) - 1];
      return { ref, ...this.toResult(hit, question) };
    });

    return {
      status: citations.length > 0 ? 'answered' : 'ungrounded',
      answer: cleaned,
      citations,
      sourcesConsidered: sources.length,
      model,
    };
  }
}

export const ragService = new RagService();
