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

/** Milliseconds from a short duration such as `15m`, `12h`, `7d` (or plain seconds). */
export const parseDuration = (value: string | undefined, fallbackMs: number): number => {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec((value ?? '').trim());
  if (!m) return fallbackMs;
  const unit = ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[m[2] ?? 's'];
  return Number(m[1]) * unit;
};

/** Accepts `v1`, `api/v1` or `/api/v1`; routes are always mounted at `/api/<prefix>`. */
export const normalizeApiPrefix = (value: string | undefined): string =>
  (value ?? '').replace(/^\/+|\/+$/g, '').replace(/^api\//, '') || 'v1';

/**
 * Uses DATABASE_URL when present; otherwise assembles it from DB_HOST/DB_USER/DB_PASSWORD/…,
 * which is how ECS injects the individual fields of an RDS-managed secret.
 */
export const resolveDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD) return '';
  const auth = `${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}`;
  const params = new URLSearchParams({ schema: env.DB_SCHEMA || 'public' });
  if (env.DB_SSL_CA) {
    params.set('sslmode', 'require');
    params.set('sslaccept', 'strict');
    params.set('sslcert', env.DB_SSL_CA);
  } else if (env.DB_SSL === 'true') {
    params.set('sslmode', 'require');
  }
  if (env.DB_CONNECTION_LIMIT) params.set('connection_limit', env.DB_CONNECTION_LIMIT);
  return `postgresql://${auth}@${env.DB_HOST}:${env.DB_PORT || '5432'}/${env.DB_NAME || 'nimbusvault'}?${params}`;
};

// Prisma reads DATABASE_URL itself, so publish the resolved value before any client is created.
const databaseUrl = resolveDatabaseUrl();
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

/** `false`, a hop count, or a comma-separated list of trusted proxy addresses/subnets. */
export const parseTrustProxy = (value: string | undefined): boolean | number | string[] => {
  const raw = (value ?? '').trim();
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
};

const frontendUrls = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export type EmbeddingProviderName = 'none' | 'local' | 'openai';
export type GenerationProviderName = 'none' | 'openai' | 'anthropic';
export type SameSite = 'strict' | 'lax' | 'none';

const embeddingProvider = (process.env.AI_EMBEDDING_PROVIDER || 'none').toLowerCase() as EmbeddingProviderName;
const generationProvider = (process.env.AI_GENERATION_PROVIDER || 'none').toLowerCase() as GenerationProviderName;

export const config = {
  nodeEnv,
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: normalizeApiPrefix(process.env.API_PREFIX),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  database: {
    url: databaseUrl,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  session: {
    /** Sliding lifetime of a refresh token. */
    refreshTtlMs: parseDuration(process.env.JWT_REFRESH_EXPIRES_IN, 7 * 86_400_000),
    /** Absolute lifetime: rotation cannot extend a session past this. */
    maxAgeMs: parseDuration(process.env.SESSION_MAX_AGE, 30 * 86_400_000),
    cookieName: 'refreshToken',
    cookieSecure: bool(process.env.COOKIE_SECURE, nodeEnv === 'production'),
    cookieSameSite: (['strict', 'lax', 'none'].includes(process.env.COOKIE_SAMESITE ?? '')
      ? process.env.COOKIE_SAMESITE
      : 'strict') as SameSite,
  },

  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },

  frontend: {
    /** Canonical origin, used to build share-link URLs. */
    url: frontendUrls[0],
    /** Every origin allowed by CORS and the CSRF check. */
    origins: frontendUrls,
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    // Leave both keys unset on AWS: the SDK then uses the ECS task role.
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Bucket: process.env.AWS_S3_BUCKET || '',
    /** Custom S3-compatible endpoint (LocalStack/MinIO). Leave unset for Amazon S3. */
    s3Endpoint: process.env.S3_ENDPOINT || '',
    /** Endpoint written into presigned URLs when browsers reach storage on a different host. */
    s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || '',
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },

  storage: {
    maxFileBytes: int(process.env.MAX_FILE_BYTES, 100 * 1024 * 1024),
    /** Presigned downloads cannot be revoked once issued, so they are short-lived. */
    downloadUrlTtlSeconds: int(process.env.DOWNLOAD_URL_TTL_SECONDS, 300),
    uploadUrlTtlSeconds: int(process.env.UPLOAD_URL_TTL_SECONDS, 900),
    /** Soft-deleted items are purged permanently after this many days (0 disables purging). */
    trashRetentionDays: int(process.env.TRASH_RETENTION_DAYS, 30),
  },

  maintenance: {
    enabled: bool(process.env.MAINTENANCE_ENABLED, !isTest),
    intervalMs: int(process.env.MAINTENANCE_INTERVAL_MS, 60_000),
    activityRetentionDays: int(process.env.ACTIVITY_RETENTION_DAYS, 365),
  },

  rateLimit: {
    // General API budget per IP. A single page load issues several requests, so this must
    // comfortably exceed normal interactive use.
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, isTest ? 10000 : 1000),
    // Credential endpoints (login/register/password change) per IP.
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, isTest ? 10000 : 30),
    // Silent refreshes are routine (one per tab per 15 minutes), so they get their own budget.
    refreshMax: int(process.env.REFRESH_RATE_LIMIT_MAX, isTest ? 10000 : 120),
    // Failed sign-ins per account, from one address and in total, per 15 minutes.
    accountFailuresPerIp: int(process.env.AUTH_ACCOUNT_FAILURES_PER_IP, isTest ? 10000 : 10),
    accountFailures: int(process.env.AUTH_ACCOUNT_FAILURES, isTest ? 10000 : 50),
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
      /** Set false when the model is baked into the image, so no network access is attempted. */
      allowRemoteModels: bool(process.env.AI_LOCAL_ALLOW_DOWNLOAD, true),
      // Cosine-similarity floor for a chunk to count as relevant evidence.
      minScore: float(process.env.AI_SEARCH_MIN_SCORE, embeddingProvider === 'openai' ? 0.3 : 0.25),
      /** Above this many accessible chunks, search switches from exact to HNSW (384-dim models). */
      annThreshold: int(process.env.AI_SEARCH_ANN_THRESHOLD, 20_000),
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
    ocr: {
      // Off by default: OCR is CPU-heavy. It runs locally (tesseract.js), so page images and
      // recognised text never leave the server.
      enabled: bool(process.env.AI_OCR_ENABLED, false),
      maxPages: int(process.env.AI_OCR_MAX_PAGES, 20),
      language: process.env.AI_OCR_LANGUAGE || 'eng',
      /** Directory holding <lang>.traineddata.gz. Empty = bundled @tesseract.js-data package. */
      dataPath: process.env.AI_OCR_DATA_PATH || '',
      pageTimeoutMs: int(process.env.AI_OCR_PAGE_TIMEOUT_MS, 60_000),
    },
    providerTimeoutMs: int(process.env.AI_PROVIDER_TIMEOUT_MS, 60_000),
    worker: {
      enabled: bool(process.env.AI_WORKER_ENABLED, !isTest),
      concurrency: Math.max(1, int(process.env.AI_WORKER_CONCURRENCY, 1)),
      pollMs: int(process.env.AI_WORKER_POLL_MS, 3000),
      staleLockMs: int(process.env.AI_WORKER_STALE_LOCK_MS, 10 * 60 * 1000),
      maxAttempts: int(process.env.AI_JOB_MAX_ATTEMPTS, 3),
      /** The standalone worker touches this file so a container health check can detect hangs. */
      heartbeatFile: process.env.AI_WORKER_HEARTBEAT_FILE || '',
    },
    limits: {
      maxFileBytes: int(process.env.AI_MAX_FILE_BYTES, 25 * 1024 * 1024),
      /** Total uncompressed size allowed inside a DOCX archive (zip-bomb protection). */
      maxUncompressedBytes: int(process.env.AI_MAX_UNCOMPRESSED_BYTES, 150 * 1024 * 1024),
      maxExtractedChars: int(process.env.AI_MAX_EXTRACTED_CHARS, 1_000_000),
      maxPdfPages: int(process.env.AI_MAX_PDF_PAGES, 500),
      chunkChars: int(process.env.AI_CHUNK_CHARS, 1200),
      chunkOverlap: int(process.env.AI_CHUNK_OVERLAP, 200),
      maxContextChars: int(process.env.AI_MAX_CONTEXT_CHARS, 12_000),
      queriesPerWindow: int(process.env.AI_QUERY_RATE_LIMIT, isTest ? 10000 : 30),
      queryWindowMs: int(process.env.AI_QUERY_RATE_WINDOW_MS, 10 * 60 * 1000),
    },
  },
};

const PLACEHOLDER = /change[-_]?me|change-in-production|dev-(access|refresh)|test-(access|refresh)|placeholder/i;

/** Configuration that would make the deployed service insecure or non-functional. */
export function productionConfigProblems(c: typeof config = config): string[] {
  const problems: string[] = [];
  const secret = (name: string, value: string) => {
    if (value.length < 32) problems.push(`${name} must be at least 32 characters`);
    else if (PLACEHOLDER.test(value)) problems.push(`${name} looks like a placeholder value`);
    else if (new Set(value).size < 10) problems.push(`${name} does not look random`);
  };
  secret('JWT_ACCESS_SECRET', c.jwt.accessSecret);
  secret('JWT_REFRESH_SECRET', c.jwt.refreshSecret);
  if (c.jwt.accessSecret === c.jwt.refreshSecret) problems.push('JWT secrets must differ');
  if (!c.database.url) problems.push('DATABASE_URL (or DB_HOST, DB_USER and DB_PASSWORD) is required');
  if (!c.aws.s3Bucket) problems.push('AWS_S3_BUCKET is required');
  if (!(c.bcrypt.rounds >= 10)) problems.push('BCRYPT_ROUNDS must be at least 10');
  for (const origin of c.frontend.origins) {
    const isLoopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin.includes('*')) problems.push('FRONTEND_URL must not contain a wildcard');
    else if (!/^https:\/\//.test(origin) && !isLoopback) problems.push(`FRONTEND_URL must use https (got ${origin})`);
  }
  if (c.session.cookieSameSite === 'none' && !c.session.cookieSecure) {
    problems.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  if (c.trustProxy === true) problems.push('TRUST_PROXY must be a hop count or an address list, not "true"');
  return problems;
}

/** Fail fast instead of serving traffic with an insecure configuration. */
export function assertProductionConfig(): void {
  if (config.nodeEnv !== 'production') return;
  const problems = productionConfigProblems();
  if (problems.length) throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
}
