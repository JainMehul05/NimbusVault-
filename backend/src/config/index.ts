import dotenv from 'dotenv';

dotenv.config();

const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const float = (value: string | undefined, fallback: number): number => {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const nodeEnv = process.env.NODE_ENV || 'development';

export type EmbeddingProviderName = 'none' | 'local' | 'openai';
export type GenerationProviderName = 'none' | 'openai' | 'anthropic';

const embeddingProvider = (process.env.AI_EMBEDDING_PROVIDER || 'none').toLowerCase() as EmbeddingProviderName;
const generationProvider = (process.env.AI_GENERATION_PROVIDER || 'none').toLowerCase() as GenerationProviderName;

export const config = {
  nodeEnv,
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',

  database: {
    url: process.env.DATABASE_URL || '',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Bucket: process.env.AWS_S3_BUCKET || '',
  },

  rateLimit: {
    // General API budget per IP. A single page load issues several requests, so this must
    // comfortably exceed normal interactive use.
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, nodeEnv === 'test' ? 10000 : 1000),
    // Credential endpoints (login/register/refresh) per IP.
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, nodeEnv === 'test' ? 10000 : 30),
  },

  ai: {
    embedding: {
      provider: embeddingProvider,
      model:
        process.env.AI_EMBEDDING_MODEL ||
        (embeddingProvider === 'openai' ? 'text-embedding-3-small' : 'Xenova/all-MiniLM-L6-v2'),
      dimensions: int(process.env.AI_EMBEDDING_DIMENSIONS, embeddingProvider === 'openai' ? 1536 : 384),
      baseUrl: process.env.AI_EMBEDDING_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.AI_EMBEDDING_API_KEY || '',
      localCacheDir: process.env.AI_LOCAL_MODEL_CACHE_DIR || '.cache/models',
      // Cosine-similarity floor for a chunk to count as relevant evidence.
      minScore: float(process.env.AI_SEARCH_MIN_SCORE, embeddingProvider === 'openai' ? 0.3 : 0.25),
    },
    generation: {
      provider: generationProvider,
      model:
        process.env.AI_GENERATION_MODEL ||
        (generationProvider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-4o-mini'),
      baseUrl:
        process.env.AI_GENERATION_BASE_URL ||
        (generationProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
      apiKey: process.env.AI_GENERATION_API_KEY || '',
      maxOutputTokens: int(process.env.AI_MAX_OUTPUT_TOKENS, 700),
      maxConcurrent: int(process.env.AI_MAX_CONCURRENT_GENERATIONS, 2),
      autoSummarize: bool(process.env.AI_AUTO_SUMMARY, true),
    },
    providerTimeoutMs: int(process.env.AI_PROVIDER_TIMEOUT_MS, 60_000),
    worker: {
      enabled: bool(process.env.AI_WORKER_ENABLED, nodeEnv !== 'test'),
      concurrency: Math.max(1, int(process.env.AI_WORKER_CONCURRENCY, 1)),
      pollMs: int(process.env.AI_WORKER_POLL_MS, 3000),
      staleLockMs: int(process.env.AI_WORKER_STALE_LOCK_MS, 10 * 60 * 1000),
      maxAttempts: int(process.env.AI_JOB_MAX_ATTEMPTS, 3),
    },
    limits: {
      maxFileBytes: int(process.env.AI_MAX_FILE_BYTES, 25 * 1024 * 1024),
      maxExtractedChars: int(process.env.AI_MAX_EXTRACTED_CHARS, 1_000_000),
      maxPdfPages: int(process.env.AI_MAX_PDF_PAGES, 500),
      chunkChars: int(process.env.AI_CHUNK_CHARS, 1200),
      chunkOverlap: int(process.env.AI_CHUNK_OVERLAP, 200),
      maxContextChars: int(process.env.AI_MAX_CONTEXT_CHARS, 12_000),
      queriesPerWindow: int(process.env.AI_QUERY_RATE_LIMIT, nodeEnv === 'test' ? 10000 : 30),
      queryWindowMs: int(process.env.AI_QUERY_RATE_WINDOW_MS, 10 * 60 * 1000),
    },
  },
};

/** Fail fast on configuration that would make the deployed service insecure. */
export function assertProductionConfig(): void {
  if (config.nodeEnv !== 'production') return;
  const problems: string[] = [];
  if (config.jwt.accessSecret.length < 32) problems.push('JWT_ACCESS_SECRET must be at least 32 characters');
  if (config.jwt.refreshSecret.length < 32) problems.push('JWT_REFRESH_SECRET must be at least 32 characters');
  if (config.jwt.accessSecret === config.jwt.refreshSecret) problems.push('JWT secrets must differ');
  if (problems.length) throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
}
