/**
 * Deterministic AI provider doubles for tests ONLY. They are installed through
 * setProvidersForTesting(), which refuses to run unless NODE_ENV=test, so they can never answer
 * real users. The embedding double is a hashed bag-of-words: texts sharing words get similar
 * vectors, which is enough to exercise real pgvector similarity search end to end.
 */
import { createHash } from 'crypto';
import {
  AiProviderError,
  type EmbeddingProvider,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from '@/modules/ai/providers';

const DIMS = 64;
const STOP = new Set(['the', 'and', 'for', 'with', 'what', 'which', 'this', 'that', 'are', 'was', 'is', 'of', 'to', 'in', 'a', 'an', 'how', 'does', 'do']);

export class HashEmbeddingDouble implements EmbeddingProvider {
  readonly name = 'test-double';
  readonly model = 'hash-bow';
  readonly dimensions = DIMS;
  readonly modelId = `test:hash-bow@${DIMS}`;
  readonly sendsDataExternally = false;
  calls = 0;
  failNext = 0;
  failPermanently = false;

  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    if (this.failPermanently) throw new AiProviderError('Embedding provider returned HTTP 401', false, 401);
    if (this.failNext > 0) {
      this.failNext--;
      throw new AiProviderError('AI provider timed out after 60000 ms', true);
    }
    return texts.map((t) => {
      const v = new Array(DIMS).fill(0);
      for (const w of t.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
        if (STOP.has(w)) continue;
        const h = createHash('md5').update(w).digest();
        v[h[0] % DIMS] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

export class RecordingGenerationDouble implements GenerationProvider {
  readonly name = 'test-double';
  readonly model = 'scripted';
  readonly sendsDataExternally = false;
  requests: GenerationRequest[] = [];
  /** Produces the reply for a request; default cites the first source. */
  reply: (req: GenerationRequest) => string = () => 'The answer is in the first source [S1].';
  fail = false;

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    if (this.fail) throw new AiProviderError('AI provider returned HTTP 503', true, 503);
    return { text: this.reply(request), model: this.model, truncated: false };
  }
}
