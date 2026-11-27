import path from 'path';
import { AiProviderError, type EmbeddingProvider } from './types';
import { isLocalUrl, postJson } from './http';

const normalize = (v: number[]): number[] => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
};

/**
 * Runs a sentence-transformer (default all-MiniLM-L6-v2, 384 dims — ADR-010) on the server's
 * CPU through transformers.js / ONNX Runtime. Document text never leaves the server.
 * The model (~23 MB) is downloaded once to `cacheDir` on first use.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly sendsDataExternally = false;
  readonly modelId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: Promise<any> | null = null;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly cacheDir: string,
    private readonly allowRemoteModels = true
  ) {
    this.modelId = `local:${model}@${dimensions}`;
  }

  private load() {
    if (!this.extractor) {
      this.extractor = (async () => {
        let transformers;
        try {
          // Optional dependency; loaded lazily so the API starts without it.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          transformers = require('@huggingface/transformers');
        } catch {
          throw new AiProviderError(
            'Local embeddings need the optional package @huggingface/transformers (npm install in backend/)',
            false
          );
        }
        transformers.env.cacheDir = path.resolve(this.cacheDir);
        // With the model baked into the image, loading never touches the network.
        transformers.env.allowRemoteModels = this.allowRemoteModels;
        transformers.env.localModelPath = path.resolve(this.cacheDir);
        return transformers.pipeline('feature-extraction', this.model, { dtype: 'fp32' });
      })().catch((err) => {
        this.extractor = null; // allow a later retry (e.g. transient download failure)
        if (err instanceof AiProviderError) throw err;
        throw new AiProviderError(`Could not load local embedding model: ${(err as Error).message}`, true);
      });
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const vectors = output.tolist() as number[][];
    for (const v of vectors) {
      if (v.length !== this.dimensions) {
        throw new AiProviderError(
          `Embedding model returned ${v.length} dimensions but AI_EMBEDDING_DIMENSIONS is ${this.dimensions}`,
          false
        );
      }
    }
    return vectors;
  }
}

/** Any OpenAI-compatible /embeddings endpoint (OpenAI, Azure-compatible gateways, Ollama, vLLM…). */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly modelId: string;
  readonly sendsDataExternally: boolean;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {
    this.modelId = `openai:${model}@${dimensions}`;
    this.sendsDataExternally = !isLocalUrl(baseUrl);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = { model: this.model, input: texts };
    // text-embedding-3-* support shortening; only send when not the model default.
    if (this.model.startsWith('text-embedding-3')) body.dimensions = this.dimensions;
    const data = await postJson<{ data: Array<{ embedding: number[]; index: number }> }>(
      `${this.baseUrl.replace(/\/$/, '')}/embeddings`,
      body,
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      this.timeoutMs
    );
    if (!Array.isArray(data?.data) || data.data.length !== texts.length) {
      throw new AiProviderError('Embedding provider returned an unexpected number of vectors', true);
    }
    const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== this.dimensions || !v.every((x) => Number.isFinite(x))) {
        throw new AiProviderError(
          `Embedding model returned ${v?.length ?? 0} dimensions but AI_EMBEDDING_DIMENSIONS is ${this.dimensions}`,
          false
        );
      }
    }
    return vectors.map(normalize);
  }
}
