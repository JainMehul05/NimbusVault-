# NimbusVault — System Architecture Document

| Field | Value |
|---|---|
| Document | Phase 0 · 02 — System Architecture |
| Style | Modular monolith API + independent AI service over shared managed data planes |
| Version | 2.0 (Hardened) |
| Companion docs | SRS (01) · Database (03) · API (04) · Security (06) · Scalability (07) · Observability (new) · Disaster Recovery (new) |

---

## 1. Architectural Principles

1. **Separate the data planes.** Bytes live in object storage; meaning lives in PostgreSQL; vectors live in ChromaDB. Each plane scales and fails independently.
2. **Never proxy bytes.** The backend mints authority (pre-signed URLs); browsers transfer directly with S3.
3. **Stateless compute.** Any replica can serve any request; all state sits in Postgres/Redis/S3.
4. **Async by default for slow work.** Extraction, embedding, purge and thumbnails run on queues, never in request handlers.
5. **Isolate the exotic runtime.** Python/ML lives in its own service with its own failure domain.
6. **Contract-first.** OpenAPI and queue schemas are versioned artifacts reviewed like code.
7. **Defense in depth.** Tenant isolation enforced at every layer — auth, ownership checks, query scoping, S3 key namespace, pre-signed expiry, vector-store filters, audit trail.
8. **Observability by default.** Structured logs, metrics, traces, and health checks on every service.

---

## 2. High-Level Architecture Diagram

```
                          ┌──────────────────────────────┐
                          │            USER              │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                          ┌──────────────▼───────────────┐
                          │   React SPA (TypeScript)     │
                          │  Tailwind · TanStack Query   │
                          └──────────────┬───────────────┘
                                         │ REST /api/v1 (JWT)
                          ┌──────────────▼───────────────┐
                          │        Backend API           │
                          │      NestJS (Node.js)        │
                          │ Auth·Files·Folders·Share·AI  │
                          └───┬───────────┬──────────┬───┘
                              │           │          │
                 metadata     │           │ events   │ pre-signed
                 queries      │           │ enqueue  │ requests
                    ┌─────────▼──┐  ┌─────▼────┐  ┌──▼──────────┐
                    │ PostgreSQL │  │  Redis   │  │   AWS S3    │◄── direct browser
                    │  (Prisma)  │  │ + Queue  │  │  versioned  │    upload/download
                    └────────────┘  └─────┬────┘  └──▲───────▲───┘
                                          │          │       │
                                    consume jobs      │       │
                               (extraction/embedding) │       │
                                          │           │       │
                               ┌──────────▼─────────┐ │       │
                               │    AI SERVICE      │─┘       │
                               │ Python · FastAPI   │         │
                               │ Extract·Embed·RAG  │         │
                               └──────┬──────┬──────┘         │
                                      │      │                │
                             ┌────────▼─┐ ┌──▼─────────┐      │
                             │ ChromaDB │ │ LLM API    │      │
                             │ vectors  │ │ OpenAI /   │      │
                             └──────────┘ │ Claude /   │      │
                                          │ Llama      │      │
                                          └────────────┘      │

        CloudFront CDN fronts static assets and accelerates pre-signed downloads.
```

**Request taxonomy.** The architecture deliberately splits traffic into three classes, each with a different path:

- **Metadata operations** (list, rename, share, query) → Backend → PostgreSQL. Small, indexed, transactional.
- **Byte transfers** (upload, download, preview stream) → Browser ↔ S3 via short-lived pre-signed URLs. Never touch our servers.
- **Slow intelligence** (extract, embed, answer) → Redis queue → AI service → ChromaDB + LLM. Fully asynchronous except the final RAG call, which is user-initiated and rate-limited.

---

## 3. Future Production Architecture (Phase 3+ Target)

```
                          ┌──────────────────────────────┐
                          │            USER              │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                          ┌──────────────▼───────────────┐
                          │        CloudFront CDN        │
                          │  Static assets · Downloads   │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                          ┌──────────────▼───────────────┐
                          │         API Gateway          │
                          │  Rate limit · Auth · Routing │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │      Backend Services        │
                          │  ┌─────────┬─────────┬─────┐ │
                          │  │ Auth    │ Files   │ ... │ │
                          │  └─────────┴─────────┴─────┘ │
                          └──────┬────────────┬──────────┘
                                 │            │
                    ┌────────────▼──┐  ┌─────▼────┐
                    │ PostgreSQL    │  │  Redis   │
                    │  (Primary)    │  │ Cluster  │
                    └───────┬───────┘  └────┬─────┘
                            │               │
                    ┌───────▼───────┐ ┌─────▼──────┐
                    │ Read Replica  │ │ Queue      │
                    │ (metadata)    │ │ (BullMQ)   │
                    └───────────────┘ └─────┬──────┘
                                            │
                                    ┌───────▼─────────┐
                                    │   AI Service    │
                                    │ Python · FastAPI│
                                    │ ┌─────────────┐ │
                                    │ │ API Pods    │ │ (RAG queries)
                                    │ ├─────────────┤ │
                                    │ │ Workers ×N  │ │ (extract/embed)
                                    │ └─────────────┘ │
                                    └───────┬─────────┘
                                             │
                                  ┌──────────▼─────────┐
                                  │ ChromaDB / pgvector│
                                  │ Vector embeddings  │
                                  └────────┬───────────┘
                                           │
                                  ┌────────▼─────────┐
                                  │ LLM Provider     │
                                  │ OpenAI / Anthropic│
                                  └──────────────────┘
```

### Component Evolution Timeline

| Component | Phase 1 (Foundation) | Phase 2 (Sharing) | Phase 3 (Cloud) | Phase 4+ (AI) | When Introduced | Problem Solved |
|-----------|---------------------|-------------------|-----------------|---------------|-----------------|----------------|
| React SPA | ✅ | ✅ | ✅ | ✅ | Phase 1 | User experience |
| Backend API | ✅ | ✅ | ✅ | ✅ | Phase 1 | Business logic |
| PostgreSQL | ✅ | ✅ | ✅ | ✅ | Phase 1 | Metadata storage |
| Redis | Queue + Cache | ✅ | Cluster | ✅ | Phase 1 | Async jobs, rate limiting, denylist |
| AWS S3 | ✅ | ✅ | Versioned + Lifecycle | ✅ | Phase 1 | Durable file storage |
| CloudFront | — | — | ✅ | ✅ | Phase 3 | Global download acceleration |
| API Gateway | — | — | ✅ | ✅ | Phase 3 | Rate limiting, auth, routing |
| AI Service | — | — | — | ✅ | Phase 4 | Document intelligence |
| ChromaDB | — | — | — | ✅ | Phase 4 | Vector similarity search |
| LLM Provider | — | — | — | ✅ | Phase 5 | RAG generation |

**Why each component exists:**
- **API Gateway**: Offloads cross-cutting concerns (rate limiting, auth validation, request routing) from application code
- **Redis Cluster**: Shared state for rate limiting, JWT denylist, queue broker — required for horizontal scaling
- **Read Replicas**: Offload read-heavy metadata queries from primary, enabling horizontal read scaling
- **CloudFront**: Reduces S3 egress costs and latency for global users
- **AI Service Separation**: Isolates GPU/CPU-heavy ML workloads from request-serving API
- **ChromaDB/pgvector**: Optimized ANN search; pgvector considered for Phase 2+ to reduce operational surface

---

## 4. Event-Driven Architecture Design

### 4.1 Event Flow Overview

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  API Layer  │────▶│  Redis      │────▶│  Worker Pool     │────▶│  Downstream     │
│  (Producer) │     │  + BullMQ   │     │  (Consumers)     │     │  Systems        │
└─────────────┘     └─────────────┘     └──────────────────┘     └─────────────────┘
       │                  │                    │                        │
       │                  │                    │                        │
       ▼                  ▼                    ▼                        ▼
  • File upload      • Job queue           • Extraction             • ChromaDB
    finalize           • Priority           • Chunking               • Embeddings
  • Share create       • Retry/backoff       • Embedding              • Index
  • Delete purge         • Dead-letter       • Thumbnail
  • RAG query            • Observability       • Virus scan
```

### 4.2 Event Types

| Event | Producer | Consumer | Payload | Retry Policy |
|-------|----------|----------|---------|--------------|
| `file.upload.finalized` | Files module | Extraction worker | `{fileId, s3Key, userId, mimeType}` | 3× exponential backoff, max 1h |
| `file.deleted` | Files module | Purge worker | `{fileId, s3Key}` | 3× exponential backoff |
| `share.created` | Share module | Notification worker | `{shareId, fileId, token}` | 3× exponential backoff |
| `ai.reindex.requested` | AI Proxy / Admin | Reindex worker | `{fileId, reason}` | 3× exponential backoff |
| `user.storage.warning` | Files module | Notification worker | `{userId, usedBytes, quotaBytes}` | No retry (fire-and-forget) |

### 4.3 Queue Design

- **BullMQ on Redis** — single broker for all async work
- **Priority levels**: `high` (user-facing: RAG queries), `normal` (extraction), `low` (purge, reconciliation)
- **Concurrency control**: Per-queue worker limits prevent resource exhaustion
- **Idempotency**: All jobs carry `fileId` + `operationId`; workers track processed IDs in Redis with 24h TTL
- **Dead-letter queue**: Jobs failing after max retries move to DLQ for manual inspection

### 4.4 Why Asynchronous Processing?

1. **Upload acknowledgment latency stays constant** regardless of AI load
2. **Failure isolation** — extraction crash doesn't break upload API
3. **Independent scaling** — workers scale on queue depth, API scales on request latency
4. **Retry semantics** — exponential backoff handles transient S3/DB/ML failures
5. **Observability** — queue depth, job latency, failure rates are first-class metrics

---

## 5. Component Responsibilities

| Component | Responsibility | Key Design Notes |
|---|---|---|
| **React SPA** | Auth screens, drive browser, uploader, previews, share dialogs, AI chat panel. | Talks only to `/api/v1` and pre-signed endpoints; holds tokens only. |
| **Backend API (NestJS)** | Business logic: auth, quotas, metadata CRUD, sharing, search orchestration, presigning, job enqueue, AI proxy. | Stateless modules behind AuthGuard; request-ID on every call. |
| **PostgreSQL** | Source of truth: users, folders, file metadata, share links, permissions, activity logs. | Prisma migrations in git; nightly backups; pooling via PgBouncer. |
| **AWS S3** | Durable binary storage; versioned bucket; lifecycle purges trash after 30 days. | Per-user key namespace; policy denies non-TLS. |
| **CloudFront** | Caches static assets; accelerates large pre-signed downloads. | Phase-3 hardening step. |
| **Redis + BullMQ** | Async jobs: extraction, embedding, purge, thumbnails. | Retry/backoff; dead-letter queue for failures. |
| **AI Service (FastAPI)** | Extraction, chunking, embedding, ANN vector search, RAG generation. | Own runtime and scaling profile; isolated failure domain. |
| **ChromaDB** | Chunk embeddings + metadata for similarity search. | Behind `VectorStore` adapter — FAISS/pgvector swappable. |
| **LLM Provider** | RAG generation step. | Behind `LlmClient` adapter — provider is a config value. |

---

## 6. Data Flow Diagrams

### (a) Upload flow (two-phase, byte-free backend)

```
Browser        Backend API         S3          Redis Queue      AI Service
   │  1 POST /files/upload-url    │              │                │
   ├────────────► │               │              │                │
   │  2 {fileId, presigned PUT}   │              │                │
   │◄─────────────│               │              │                │
   │  3 PUT bytes (direct)        │              │                │
   ├─────────────────────────────►│              │                │
   │  4 POST /files (finalize)    │              │                │
   ├────────────► │ 5 HEAD object │              │                │
   │              ├──────────────►│              │                │
   │              │ 6 tx: insert metadata READY + quota update     │
   │              │ 7 enqueue extract-job        │                │
   │◄─ 201 {file} │               │              ├───────────────►│ consume
   │              │               │       8 download·extract·chunk│
   │              │               │       9 embed → ChromaDB      │
```

### (b) RAG query flow

```
Browser        Backend API       AI Service     ChromaDB      LLM API
   │ 1 POST /ai/query {question} │              │             │
   ├────────────►│ 2 verify JWT + access to scope │             │
   │             │ 3 forward query ├────────────►│             │
   │             │                 │ 4 embed q   │             │
   │             │                 │ 5 top-k ANN (tenant-filtered)│
   │             │                 │◄─ chunks ───┤             │
   │             │                 │ 6 prompt(chunks+question) │
   │             │                 ├──────────────────────────►│
   │             │                 │◄──── answer ──────────────┤
   │◄─ 200 {answer, sources[]} ───┤  7 citations mapped back   │
```

### (c) Share-link redemption (public, no account)

```
Visitor → GET /api/share/:token → validate exists? revoked? expired? exhausted?
         → optional password challenge → mint short-lived pre-signed GET(s)
         → visitor previews/downloads directly from S3 → redemption logged.
```

---

## 7. Architectural Decision Rationale

**Why files are not stored in the database.**
Databases optimize for small, indexed, transactional records — not multi-megabyte blobs. Blobs inflate backups, bloat WAL and cache, cap throughput, and lock storage scaling to the database engine. S3 inverts every one of those costs: effectively infinite capacity, 11-nines durability, versioning, lifecycle rules, and bandwidth that scales with AWS's network rather than our DB connection pool. PostgreSQL stores a 60-byte pointer (`s3_key`) instead of a 100 MB payload.

**Why the backend does not handle file bytes.**
A Node process streaming uploads through itself pays memory, socket and bandwidth tax per concurrent transfer; ten simultaneous 100 MB uploads can exhaust a small instance. Pre-signed URLs move that work to the browser↔S3 edge: our server performs ~150 µs of signing per transfer regardless of file size. This is also how Drive-class products operate — the API authorizes, storage serves.

**Why the AI service is separated.**
Three independent reasons. (1) *Runtime*: the ML ecosystem (sentence-transformers, PyMuPDF, torch) is Python-native; reimplementations in Node are weaker. (2) *Scaling profile*: embedding/extraction is CPU-heavy and bursty while CRUD is I/O-light — separate services let each scale independently so an embedding burst never starves file listings. (3) *Fault isolation*: a model load OOM must not take down authentication or uploads.

**Why metadata and storage are separated.**
Metadata queries (list folder, search names, check quota) run thousands of times per upload-equivalent of byte traffic. Co-locating them with blob management would couple a fast transactional workload to a slow bulk one. Split planes mean PostgreSQL stays small, cache-friendly and backup-cheap while S3 absorbs growth; each can scale, fail, and be restored independently.

---

## 8. Deployment View (Phase 3 target state)

```
                         Route53 / ACM (TLS)
                               │
                         ALB (HTTPS only)
                        ┌──────┴──────┐
                  EC2 t3.small ×N   EC2 t3.small
                  NestJS containers  FastAPI container (+ worker)
                        │                  │
             RDS-class PostgreSQL   Redis (ElastiCache-class or same host, dev)
                        │                  │
                       S3 (versioned) ── CloudFront edge
```

Containers are built once in CI and deployed identically to staging and production. Local development runs the *same images* under docker-compose with MinIO substituting S3.