# Environment variables

Backend settings (`backend/src/config/index.ts` is authoritative). Required in production: ✔.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables the checks below and secure cookies |
| `PORT` | 3000 | |
| `API_PREFIX` | `v1` | Routes are at `/api/<prefix>`; `api/v1` is accepted too |
| `FRONTEND_URL` ✔ | `http://localhost:5173` | Allowed origins, comma-separated; the first builds share-link URLs. https in production |
| `TRUST_PROXY` | off | Proxy hops (AWS: 2, Compose: 1) or an address list. Never `true` |
| `DATABASE_URL` ✔ | | Or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL_CA`, `DB_CONNECTION_LIMIT` |
| `JWT_ACCESS_SECRET` ✔, `JWT_REFRESH_SECRET` ✔ | | 32+ random characters, different. Refresh tokens are opaque; the second key is reserved |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `7d` | |
| `SESSION_MAX_AGE` | `30d` | Absolute session lifetime |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | production, `strict` | `none` only if API and app are on different sites |
| `BCRYPT_ROUNDS` | 12 | At least 10 in production |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `REFRESH_RATE_LIMIT_MAX` | 1000, 30, 120 | Per IP per 15 minutes |
| `AUTH_ACCOUNT_FAILURES_PER_IP`, `AUTH_ACCOUNT_FAILURES` | 10, 50 | Failed sign-ins per account per 15 minutes |
| `AWS_REGION`, `AWS_S3_BUCKET` ✔ | `us-east-1` | |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | | Leave unset on AWS (task role) |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_FORCE_PATH_STYLE` | | LocalStack/MinIO only |
| `MAX_FILE_BYTES` | 104857600 | |
| `DOWNLOAD_URL_TTL_SECONDS` / `UPLOAD_URL_TTL_SECONDS` | 300 / 900 | |
| `TRASH_RETENTION_DAYS`, `ACTIVITY_RETENTION_DAYS` | 30, 365 | 0 disables |
| `MAINTENANCE_ENABLED` | true | Off for the API when a worker runs |
| `LOG_LEVEL`, `PRISMA_LOG_QUERIES` | | Query logging prints data; development only |

AI (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `AI_EMBEDDING_PROVIDER` | `none` | `none`, `local`, `openai` |
| `AI_LOCAL_MODEL_CACHE_DIR`, `AI_LOCAL_ALLOW_DOWNLOAD` | `.cache/models`, true | |
| `AI_GENERATION_PROVIDER`, `_MODEL`, `_API_KEY`, `_BASE_URL` | `none` | `none`, `openai`, `anthropic` |
| `AI_OCR_ENABLED`, `AI_OCR_MAX_PAGES`, `AI_OCR_LANGUAGE` | false, 20, `eng` | Local OCR of scanned PDFs |
| `AI_WORKER_ENABLED`, `AI_WORKER_CONCURRENCY`, `AI_WORKER_HEARTBEAT_FILE` | true, 1 | |
| `AI_SEARCH_MIN_SCORE`, `AI_SEARCH_ANN_THRESHOLD` | 0.25, 20000 | Exact search below the threshold, HNSW above |
| `AI_MAX_FILE_BYTES`, `AI_MAX_UNCOMPRESSED_BYTES`, `AI_MAX_PDF_PAGES` | 25 MB, 150 MB, 500 | |
| `AI_QUERY_RATE_LIMIT` | 30 per 10 min per user | |

Frontend: `VITE_API_URL` (build time, only if the API is on another origin), `API_PROXY_TARGET` (development proxy).
