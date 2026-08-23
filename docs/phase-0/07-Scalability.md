# NimbusVault — Scalability Design Document

| Field | Value |
|---|---|
| Document | Phase 0 · 07 — Scalability Design (Hardened) |
| Principle | Scale by *trigger*, not speculation — every mechanism below names the metric that activates it |
| Version | 2.0 (Hardened) |

---

## 1. Scaling Strategy by Dimension

### 1.1 Storage — AWS S3
- Elastic by design: no sharding logic exists in application code; growth is a billing event, not a re-architecture.
- **Versioning** enables recovery from deletes/overwrites without backup restores.
- **Lifecycle rules**: incomplete multipart uploads aborted at 7 days; trash objects expire at 30 days.
- *Trigger:* none needed, ever, for capacity. Cost alarms (80% of budget) are the only watchpoint.

### 1.2 Backend Tier — Stateless Horizontal Scaling
- JWTs mean zero server-side sessions; any replica serves any request; scale = add containers to the ALB target group.
- In-memory rate-limit counters **must move to Redis before replica #2 exists** (counters shared across instances).
- Long-lived work already lives in queues, so replicas stay I/O-light and replaceable mid-request.
- *Trigger:* sustained CPU >60% or p95 latency >300 ms on one instance → add second instance.

### 1.3 Database — Indexes First, Pooling Always, Replicas Last

| Mechanism | Design | Trigger |
|---|---|---|
| **Indexing** | Composite indexes cover every documented access path (see Database doc §3): `(owner_id, folder_id, deleted_at)` for browse, `(owner_id, deleted_at, uploaded_at DESC)` for trash/recent, GIN trigram on `filename` for search. `EXPLAIN` review required in PRs touching queries | Query p95 >500 ms with indexes confirmed used |
| **Connection Pooling** | PgBouncer (transaction mode) sits between NestJS and PostgreSQL. Serverless-style event loops open "connections" cheaply and would otherwise exhaust Postgres backends under concurrency. Pool sizing: ~20 connections per API instance ceiling | Activated from day one — it is configuration, not a reaction |
| **Read Replicas** | Prisma client extension routes reads (list/search) to a replica; writes stay primary. Replication lag tolerance: listing may be ≤1 s stale; quota checks and finalize writes always hit primary | Read:write ratio >5:1 or primary CPU >50% sustained |
| **Table Growth** | `activity_logs` monthly partitions; BRIN index on `created_at` | >10M log rows |
| **Quota Correctness at Scale** | Denormalized counter updated via atomic conditional UPDATE (no read-modify-write), so contention stays row-local and race-free | None — designed-in |

### 1.4 Large Files & Transfer Throughput — Pre-signed URLs + CDN
- Byte volume never touches app servers, so transfer scaling is AWS's problem: S3 scales per-key request rates automatically; each pre-signed URL is one object.
- **CloudFront** fronts downloads once users are geographically distributed or popular files get repeated views; edge caching absorbs repeat traffic and cuts S3 request costs.
- Video previews rely on HTTP range requests against pre-signed URLs — seeking streams without downloading whole files.
- *Trigger for CloudFront:* Phase 3 hardening gate, or any user >200 km from the bucket region.

### 1.5 Background Tasks — Redis + BullMQ
- All slow work (extraction, embedding, purge, reconciliation) is queued; upload acknowledgment latency stays constant regardless of AI load.
- Workers scale horizontally by *queue depth*: N consumer processes pull idempotent jobs; retries use exponential backoff; failures land in a dead-letter queue for inspection rather than blocking the lane.
- Job payloads carry `{fileId, s3Key, userId}` only — workers re-fetch bytes from S3, keeping jobs small and retry-safe.
- *Trigger:* median job wait >30 s → add worker process.

### 1.6 Caching Strategy — Redis

| Cache Layer | What | TTL | Invalidation |
|---|---|---|---|
| **Rate Limit Counters** | Sliding window counts per user/IP | Window size (1-15 min) | Automatic expiry |
| **JWT Denylist** | Revoked access token JTIs | Token remaining TTL | Automatic expiry |
| **User Profile** | `/auth/me` response | 5 min | On profile update, password change, session revoke |
| **File Metadata** | Frequently accessed files | 1 min | On file update/delete/restore |
| **Folder Tree** | Browse folder children | 30 sec | On folder/file create/delete/move |
| **Search Results** | Metadata search queries | 30 sec | On file create/update/delete |
| **Share Link Status** | Public redemption validation | 30 sec | On revoke/expiry/download |

**Implementation:** Redis Cluster (Phase 3+); single instance with persistence for Phase 1-2.
**Cache-Aside Pattern:** Application checks cache → if miss, queries DB → stores in cache → returns.
**Stale-While-Revalidate:** For read-heavy endpoints, serve stale data while async refresh runs.

### 1.6 AI Service — Independent Scaling
- The FastAPI service separates **API pods** (RAG query path) from **worker processes** (extraction/embedding path); they scale on different signals (request latency vs queue depth).
- Embedding model runs CPU-only (~80 MB MiniLM) — one t3.small handles demo-scale throughput; batching raises per-process efficiency before hardware changes are needed.
- Vector store isolation means re-index storms cannot degrade CRUD APIs even if ChromaDB saturates.
- LLM calls are the latency floor: mitigate with smaller context top-k, streaming responses, and provider fallback adapter.
- *Trigger:* RAG p95 >8 s or extraction backlog growing monotonically.

### 1.7 Vector Database Scaling
| Phase | Solution | Trigger |
|---|---|---|
| Phase 4 | ChromaDB embedded | ≤1M vectors |
| Phase 5 | ChromaDB client-server | >1M vectors or multi-worker |
| Phase 6+ | pgvector / managed (Pinecone) | >10M vectors or multi-region |

---

## 2. Scaling Roadmap

| Stage | Users | Topology | Activation Trigger |
|---|---|---|---|
| S0 — demo | ≤100 | 1×EC2 (API+AI), Postgres same host, MinIO locally / S3 single bucket | Day-one baseline |
| S1 — growth | 100–10k | 2+ API replicas behind ALB · PgBouncer · separate Redis · dedicated AI worker(s) · CloudFront on | Latency/CPU triggers above |
| S2 — scale | >10k | DB read replicas + partitioned logs · autoscaled worker fleet on queue depth · multi-AZ Postgres · ChromaDB→pgvector/managed vector service | Sustained growth, read ratio, corpus size |

---

## 3. Load Profiles (what we design against)

| Profile | Definition | Must Hold |
|---|---|---|
| Demo day | 50 concurrent users browsing, 5 uploading, 2 querying AI | All NFR latency targets met |
| Burst | 20 simultaneous 100 MB uploads + normal browsing | Upload-url issuance unaffected (<150 ms presign); no API errors |
| Index storm | 500 files uploaded within 10 min | Queue drains <15 min; zero impact on browse latency |

---

## 4. Performance Budgets (NFR Targets)

| Metric | Target | Measurement |
|---|---|---|
| Metadata API p95 | ≤300 ms @ 50 concurrent users | k6 load test |
| Presign URL issuance p95 | ≤150 ms | Load test |
| Filename search p95 | ≤500 ms @ 100k rows | Seeded load test |
| Semantic search p95 | ≤1.5 s | Eval harness timing |
| RAG answer p95 | ≤8 s end-to-end | Eval harness timing |
| Upload success rate (≤100 MB) | ≥99.5% | Production monitoring |
| Golden-question recall@3 | ≥80% | Eval harness |
| Grounded-answer rate | ≥90% | Eval harness |
| Refusal correctness | ≥95% | Eval harness |

---

## 5. Cost-Aware Scaling

| Resource | Cost Driver | Optimization |
|---|---|---|
| **EC2** | Instance hours | Right-size (t3.small → t3.medium); stop dev at night |
| **S3** | Storage + requests | Lifecycle to IA/Glacier; CloudFront reduces GET costs |
| **RDS** | Instance + storage | Read replicas only when read:write >5:1 |
| **ElastiCache** | Node hours | Single node until Cluster needed |
| **OpenAI API** | Token volume | MiniLM local embeddings; GPT-4o-mini for generation; budget alarm |
| **EBS/Snapshots** | GB-month | Incremental snapshots; 7-day retention |

**Monthly Budget Envelope:** ≤$40 (student credits)
- EC2 t3.small ×2: ~$30
- S3 ~50 GB: ~$1.20
- CloudFront egress: ~$2
- OpenAI API: ~$5 capped
- EBS+snapshots: ~$3

---

## 6. Capacity Planning Checklist

Before each sprint, verify:

- [ ] Current p95 latencies within budget
- [ ] Queue depths healthy (<30s median wait)
- [ ] DB connection pool utilization <70%
- [ ] Redis memory <80%
- [ ] S3 costs within 80% of budget
- [ ] AI token usage <80% of monthly cap
- [ ] Backup/restore drill current (RTO ≤4h)

---

*Scale by trigger, not speculation. Every mechanism above names the metric that activates it.*