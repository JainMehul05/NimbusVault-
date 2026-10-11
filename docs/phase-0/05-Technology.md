# NimbusVault — Technology Decision Document

| Field | Value |
|---|---|
| Document | Phase 0 · Technology Selection & Architecture Decision Records |
| Method | Every choice records: why chosen → alternatives → decisive rationale |
| Change policy | Reversals require a new ADR appended to §10 — decisions are never silently edited |

## 1. Decision Summary Matrix

| Layer | Selected | Runner-up | ADR |
|---|---|---|---|
| Frontend framework | React 18 + TypeScript + Vite | Vue 3, SvelteKit | ADR-001 |
| Styling | Tailwind CSS | CSS Modules, MUI | ADR-002 |
| Backend runtime | Node.js + NestJS (TypeScript) | Express, Django/FastAPI monolith | ADR-003 |
| Database | PostgreSQL 16 + Prisma ORM | MySQL, MongoDB | ADR-004/005 |
| Object storage | AWS S3 (+ CloudFront) | MinIO, GCS | ADR-006 |
| Hosting/compute | AWS EC2 behind ALB, Dockerized | Render/Railway, Kubernetes | ADR-007 |
| CI/CD | GitHub Actions + Docker Hub/ECR | Jenkins, GitLab CI | ADR-008 |
| AI service | Python 3.11 + FastAPI | Node ML stack, monolith embedding | ADR-009 |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` | OpenAI embeddings API | ADR-010 |
| Vector store | ChromaDB (adapter-isolated) | FAISS, pgvector, Pinecone | ADR-011 |
| RAG generation | OpenAI GPT-4o-mini (adapter) | Claude Haiku, local Llama 3 | ADR-012 |
| Async jobs | Redis + BullMQ | Cron in-app, Celery | ADR-013 |

---

## 2. Frontend

### React + TypeScript + Vite (ADR-001)
- **Why:** Largest ecosystem for file-heavy UIs (uploaders, virtualized lists, preview components); TypeScript catches contract mismatches against our typed API before runtime; Vite gives sub-second HMR and simple builds.
- **Alternatives:** *Vue 3* — equally capable, smaller hiring pool among teammates; *SvelteKit* — elegant but thinner component ecosystem for drag-drop upload and PDF viewers; *Angular* — heavyweight for a 1-member frontend effort.
- **Deciding factor:** Team familiarity plus richest off-the-shelf pieces (`react-pdf`, `@tanstack/react-virtual`, dropzone libs) directly de-risk the two hardest UI features: uploads at scale and document preview.

### Tailwind CSS (ADR-002)
- **Why:** Utility classes keep styling co-located with markup; design consistency enforced via config tokens; no CSS-naming debates across PRs.
- **Alternatives:** *CSS Modules* — fine but slower iteration and duplicated spacing/type scales; *Material UI* — fast start but every Drive-like screen fights the library's opinions.
- **Deciding factor:** A storage product lives or dies on custom layout density (file grids, breadcrumbs, preview panes); Tailwind makes that bespoke work cheap.

## 3. Backend

### Node.js + NestJS with Express under the hood (ADR-003)
- **Why:** One language (TypeScript) across frontend and backend shrinks context-switching for a 4-person team; NestJS enforces the module/controller/service layering our maintainability NFR demands, ships dependency injection, guards (authZ), pipes (validation) and first-class OpenAPI generation from decorators.
- **Alternatives:** *Bare Express* — minimal and familiar, but structure discipline would depend entirely on code review; *Django* — batteries included yet splits languages and its async story is weaker for I/O-heavy presign-and-proxy workloads.
- **Deciding factor:** The architecture's core risk is *organizational* (4 students merging code for months). NestJS's enforced conventions are insurance; its decorator-generated Swagger keeps doc 03 honest automatically.

## 4. Data Layer

### PostgreSQL 16 (ADR-004)
- **Why:** Storage metadata is inherently relational (ownership trees, share links, grants). We get FK integrity, ACID transactions for quota accounting, JSONB where flexibility is needed, trigram/GIN indexes for filename search, and a clear path to read replicas.
- **Alternatives:** *MySQL* — viable, weaker extension ecosystem; *MongoDB* — schemaless appeal evaporates here because our domain *is* relations; enforcing folder/share integrity in app code invites drift bugs.
- **Deciding factor:** Transactions around quota updates + finalize inserts are non-negotiable for correctness under concurrency.

### Prisma ORM (ADR-005)
- **Why:** Schema-as-code with versioned migrations; type-safe client generated from `schema.prisma` means DB changes surface as compile errors; parameterization by default kills SQL-injection class bugs.
- **Alternatives:** *TypeORM* — decorator sprawl, historically buggier migrations; *Knex* — query builder only, no migration ergonomics at this level; *raw pg* — maximum control, minimum safety.
- **Deciding factor:** Migration reviewability + compile-time safety align exactly with our "integrity in schema" principle.

## 5. Cloud & DevOps

### AWS S3 + CloudFront (ADR-006)
- **Why:** 11-nines durability, versioned buckets (ransomware/accidental-delete recovery), lifecycle rules automate trash purge, pre-signed URLs remove byte traffic from our servers, CloudFront accelerates large downloads globally.
- **Alternatives:** *MinIO* — self-hosted S3 API; excellent for offline dev/test parity (adopted in docker-compose), not as a production target; *GCS/Azure* — equivalent peers; AWS won on free-tier credits and team familiarity.
- **Deciding factor:** Pre-signed URL economics — the single most consequential scalability decision in the system.

### EC2 + ALB, Dockerized (ADR-007)
- **Why:** Two t-series instances (API + AI) behind an application load balancer give real ops experience (SSH, nginx/TLS, systemd or containers) that PaaS hides — valuable for a cloud-computing learning goal. Stateless design means scaling = adding instances to the target group.
- **Alternatives:** *Render/Railway* — faster start but abstracts away the cloud skills the project exists to teach; *Kubernetes* — operationally absurd for a 4-student budget; noted as the natural next step once multi-service orchestration pain becomes real.
- **Deciding factor:** Pedagogy × budget: raw-enough-to-learn, managed-enough-to-finish.

### GitHub Actions + Docker (ADR-008)
- **Why:** CI lives beside the repo (zero extra infra); matrix builds run frontend/backend/AI test suites in parallel; Docker guarantees "works on my machine" dies here — images built in CI are the exact artifacts deployed to EC2.
- **Alternatives:** *Jenkins* — self-managed server maintenance is a time sink; *GitLab CI* — implies moving repos.
- **Deciding factor:** Native GitHub integration + generous free tier for education.

## 6. AI Stack

### Python + FastAPI service (ADR-009)
- **Why:** Python owns text extraction (PyMuPDF/pdfplumber, python-docx, python-pptx) and embedding inference (sentence-transformers/torch). FastAPI adds async endpoints, Pydantic validation, and auto docs with negligible boilerplate. Deployed as its own container consuming queue jobs — fault-isolated from the Node API.
- **Alternatives:** *Node-only ML* — no mature equivalent to sentence-transformers; *monolith* — couples CPU-bound model loads to request handling and violates independent-scaling NFR.
- **Deciding factor:** Library gravity. The AI feature is only as good as its extraction/embedding tooling.

### all-MiniLM-L6-v2 embeddings (ADR-010)
- **Why:** 384-dim, strong retrieval quality on short/medium passages, ~80 MB model — runs CPU-only on a small instance; fully local ⇒ zero per-query cost and no data leaves our infrastructure.
- **Alternatives:** *OpenAI text-embeddings-3-small* — higher ceiling but per-token cost, network latency, and privacy trade-off; *BGE-large* — heavier than our hardware justifies.
- **Deciding factor:** Quality-per-CPU-cycle at zero marginal cost; swap interface preserved if corpus scale demands it.

### ChromaDB vector store (ADR-011)
- **Why:** Embedded-mode deployment (no extra server), persistent local storage, metadata filtering (we filter by permitted `file_id`s at query time), Python-native.
- **Alternatives:** *FAISS* — fastest raw ANN but persistence/metadata handling is DIY; *pgvector* — one database fewer to operate and transactional with metadata; strong candidate for v2 via the adapter; *Pinecone* — managed SaaS cost + external dependency for a student budget.
- **Deciding factor:** Fastest correct start; the `VectorStore` port interface keeps FAISS/pgvector one PR away.

### OpenAI GPT-4o-mini for generation (ADR-012)
- **Why:** RAG quality is dominated by retrieval; generation needs instruction-following and citation discipline more than frontier intelligence. Mini-class models are cheap enough for demos and fast enough for p95 ≤ 8 s targets.
- **Alternatives:** *Claude Haiku* — comparable; kept warm as fallback provider; *local Llama 3 8B* — zero API cost but needs GPU we don't have; documented as the offline-demo fallback via Ollama adapter.
- **Deciding factor:** Cost/latency/quality triangle with a hard adapter boundary so the provider is a config value, not an architecture.

### Redis + BullMQ queues (ADR-013)
- **Why:** Extraction/embedding must never block uploads. BullMQ gives retries-with-backoff, rate control, priorities, and dead-letter visibility on Redis — which we already run for caching/denylist.
- **Alternatives:** *Celery* — Python-side only, splits job infrastructure across services; *in-process setTimeout workers* — lose jobs on deploy, no retry semantics.
- **Deciding factor:** One broker serving both Node producers and Python consumers keeps the async backbone uniform.

---

## 7. Rejected-by-design (recorded to prevent relitigating)

| Idea | Rejected because |
|---|---|
| Streaming files through the API | Ties up event-loop memory/bandwidth; pre-signed URLs do it better (see Doc 01 §5.5) |
| WebSockets everywhere | No real-time requirement in v1; polling + optimistic UI suffices; revisit for live collaboration |
| Server-side sessions | Break stateless horizontal scaling; JWT chosen deliberately |
| Microservice split of auth/files/sharing | Premature — modular monolith with strict module boundaries delivers the same discipline without distributed-systems tax |
| GraphQL API | REST + OpenAPI sufficient; GraphQL adds complexity without clear benefit for this domain |
| Monorepo with shared TypeScript types | Current structure with OpenAPI-generated types is sufficient; avoids version coupling |

---

## 8. Version Pins (baseline)

React 18 · TypeScript 5.x · Vite 5 · Tailwind 3 · Node 20 LTS · NestJS 10 · Prisma 5 · PostgreSQL 16 · Redis 7 · Python 3.11 · FastAPI 0.110+ · sentence-transformers 3.x · ChromaDB 0.5 · Docker Compose v2.

---

## 9. Cost Envelope (monthly, demo-scale)

EC2 t3.small ×2 (~$30) · S3 ~50 GB (~$1.2) · CloudFront egress (~$2) · OpenAI API (~$5 capped) · EBS+snapshots (~$3) → **≈ $40/month**, within student credit budgets.

---

## 10. ADR Log

| ID | Decision | Status | Date | Author |
|---|---|---|---|---|
| ADR-001 | React 18 + TypeScript + Vite for frontend | Accepted | Aug 2026 | M2 |
| ADR-002 | Tailwind CSS for styling | Accepted | Aug 2026 | M2 |
| ADR-003 | Node.js + NestJS (TypeScript) for backend | Accepted | Aug 2026 | M1 |
| ADR-004 | PostgreSQL 16 for primary database | Accepted | Aug 2026 | M1 |
| ADR-005 | Prisma ORM for database access | Accepted | Aug 2026 | M1 |
| ADR-005b | CITEXT extension for case-insensitive email | Accepted | Aug 2026 | M1 |
| ADR-006 | AWS S3 + CloudFront for object storage | Accepted | Aug 2026 | M3 |
| ADR-007 | AWS EC2 + ALB, Dockerized deployment | Accepted | Aug 2026 | M3 |
| ADR-008 | GitHub Actions + Docker for CI/CD | Accepted | Aug 2026 | M3 |
| ADR-009 | Python 3.11 + FastAPI for AI service | Accepted | Aug 2026 | M4 |
| ADR-010 | all-MiniLM-L6-v2 for embeddings (local, CPU) | Accepted | Aug 2026 | M4 |
| ADR-011 | ChromaDB for vector store (adapter-isolated) | Accepted | Aug 2026 | M4 |
| ADR-012 | OpenAI GPT-4o-mini for RAG generation (adapter) | Accepted | Aug 2026 | M4 |
| ADR-013 | Redis + BullMQ for async job queue | Accepted | Aug 2026 | M1/M4 |
| ADR-014 | Pino for structured logging (JSON) | Accepted | Aug 2026 | M1 |
| ADR-015 | PgBouncer for connection pooling | Accepted | Aug 2026 | M1 |
| ADR-016 | Zod for runtime validation | Accepted | Aug 2026 | M1 |
| ADR-017 | PgBouncer in transaction mode | Accepted | Aug 2026 | M1 |
| ADR-018 | OpenTelemetry for distributed tracing | Accepted | Aug 2026 | M3 |
| ADR-019 | Prometheus + Grafana for metrics | Accepted | Aug 2026 | M3 |
| ADR-020 | OpenSearch for log aggregation | Accepted | Aug 2026 | M3 |
| ADR-021 | RDS Multi-AZ for HA PostgreSQL | Accepted | Aug 2026 | M3 |
| ADR-022 | S3 Cross-Region Replication for DR | Accepted | Aug 2026 | M3 |
| ADR-023 | PgBouncer prepared statements disabled | Accepted | Aug 2026 | M1 |

*Future ADRs append here with rationale and rollback notes.*

---

## 11. Hardening Decisions (Phase 0.5 → 1.5)

| ID | Decision | Rationale | Impact |
|---|---|---|---|
| HD-001 | Standardized API response envelope (success/error) | Consistency across all endpoints; client can handle uniformly | Frontend simplifies error handling |
| HD-002 | Request ID propagation end-to-end | Traceability across services | Debugging time reduced |
| HD-003 | Zod validation on all public endpoints | Runtime type safety matching compile-time | Prevents invalid data at boundary |
| HD-004 | Structured JSON logging (Pino) | Searchable, correlatable logs | Faster debugging |
| HD-005 | JWT denylist in Redis for logout | Immediate revocation without DB round-trip | Security |
| HD-006 | Refresh token rotation + family tracking | Theft detection via reuse detection | Security |
| HD-007 | Session management table | Concurrent session limits, audit, forced logout | Security + UX |
| HD-008 | Activity log for all mutations | Audit trail, security review | Compliance + Security |
| HD-009 | Standardized error envelope | Client can handle errors programmatically | Frontend UX |
| HD-010 | Pagination/filtering/sorting conventions | Consistent API UX | Frontend simplicity |
| HD-011 | Health/Readiness endpoints | Kubernetes/ALB integration | Reliability |
| HD-012 | Request ID in all logs/metrics/traces | End-to-end traceability | Debugging |
| HD-014 | Redis caching layer with TTL strategies | Reduce DB load, improve latency | Performance |
| HD-015 | Redis rate limiting (sliding window) | Distributed rate limiting across replicas | Security + Fairness |
| HD-016 | JWT denylist in Redis | Immediate token revocation | Security |
| HD-017 | S3 checksum verification at finalize | Integrity guarantee | Data quality |
| HD-018 | OpenTelemetry tracing | End-to-end visibility | Observability |
| HD-018 | Prometheus metrics + Grafana dashboards | RED/USE metrics per service | Operations |
| HD-019 | Alerting with runbooks | Actionable alerts | Incident response |
| HD-019 | Monthly restore drill automation | Verified backups | Disaster recovery |
| HD-020 | Quarterly full DR drill | Verified RTO/RPO | Disaster recovery |