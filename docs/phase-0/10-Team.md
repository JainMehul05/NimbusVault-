# NimbusVault — Team Responsibility Document

| Field | Value |
|---|---|
| Document | Phase 0 · 10 — Team Ownership |
| Model | End-to-end domain ownership: each member designs, builds, tests, deploys, documents and demos their slice |
| Rhythm | Daily 15-min standup (async) · weekly 60-min architecture sync · 2-week sprints with demo |

## 1. Member 1 — Backend & Database Engineer

| Dimension | Detail |
|---|---|
| **Mission** | The API is the product's spine — correct under concurrency, fast per SRS targets, documented by contract. |
| **Responsibilities** | Prisma schema + migrations; Auth module (JWT/refresh rotation/logout denylist); Files, Folders, Shares, Search modules; pre-signed URL minting; quota transactions; activity logging; OpenAPI accuracy; backend unit/integration suites incl. tenant-isolation tests; k6 load runs. |
| **Technologies** | Node.js 20, NestJS, TypeScript strict, Prisma, PostgreSQL 16, Redis/BullMQ (producer), Jest/Supertest, k6. |
| **Deliverables** | `backend/` service ≥70% core coverage · versioned migration set through the Doc-03 §7 pipeline · published OpenAPI spec matching Doc 04 · auth+file integration suites green · latency report vs NFR table. |
| **Depends on** | M3 for Postgres/Redis provisioning and bucket CORS/policy config; provides contract to M2 and queue schema to M4. |

## 2. Member 2 — Frontend & UI Engineer

| Dimension | Detail |
|---|---|
| **Mission** | A Drive-class experience: uploads feel instant, navigation obvious, previews native. |
| **Responsibilities** | Design system (Tailwind tokens); auth screens; drive browser (grid/list, breadcrumbs); drag-drop uploader with progress/retry; previews (PDF/image/video); share dialog + public redemption page; search UX + AI chat panel with citations; TanStack Query cache discipline; component tests + Playwright golden paths; accessibility pass. |
| **Technologies** | React 18, TypeScript, Vite, Tailwind, TanStack Query/Virtual, react-pdf, Playwright, axe, Lighthouse CI. |
| **Deliverables** | `frontend/` SPA wired to live API · upload pipeline resilient to network failure · e2e suite green on CI · Lighthouse ≥85 · zero critical a11y violations. |
| **Depends on** | M1's contract (mock server until staging exists); M3 for deployment target of static assets. |

## 3. Member 3 — AWS Cloud & Infrastructure Engineer

| Dimension | Detail |
|---|---|
| **Mission** | Everything runs repeatably, observably, securely, cheaply — locally identical to production. |
| **Responsibilities** | AWS account hygiene (IAM users/roles/MFA/budget alarms); S3 design — versioning, lifecycle, TLS-only policy, CORS for browser presigned transfers; EC2 provisioning (API + AI hosts) behind ALB with ACM TLS; CloudFront; Docker images + compose parity; GitHub Actions pipelines (lint→test→build→push→deploy); CloudWatch dashboards/alarms; backup/restore runbook + drill; cost reporting. |
| **Technologies** | AWS S3/EC2/IAM/CloudFront/CloudWatch, Docker, docker-compose, GitHub Actions, bash, Terraform (stretch). |
| **Deliverables** | One-command local stack (`docker compose up`) · one-click deploy from `main` · monitoring dashboard + alert routing · passed restore drill proving RTO ≤4 h · monthly cost report vs $40 envelope. |
| **Depends on** | Consumes build artifacts from all members' CI; consulted by everyone for env vars/secrets naming (`.env.example` contracts). |

## 4. Member 4 — AI & DevOps Engineer

| Dimension | Detail |
|---|---|
| **Mission** | Documents that answer questions — retrieval quality is the feature; hallucination is the bug. |
| **Responsibilities** | FastAPI service (health/query/status endpoints); extraction pipeline (PyMuPDF/python-docx/python-pptx/TXT-MD-CSV); chunking strategy (~1000 tokens, overlap, section-aware); sentence-transformers embedding; ChromaDB schema + tenant-scoped ANN queries; RAG orchestration with citation enforcement + low-confidence refusal; BullMQ consumer honoring shared job schema; evaluation harness (golden Q/A set, recall@k, grounding, refusal metrics); reindex/failure recovery; shares DevOps duty with M3 (ai-service CI, deploy automation). |
| **Technologies** | Python 3.11, FastAPI, Pydantic, sentence-transformers (`all-MiniLM-L6-v2`), ChromaDB, LLM SDKs behind adapter (GPT-4o-mini primary, Ollama/Llama fallback), pytest, eval harness. |
| **Deliverables** | `ai-service/` container consuming jobs end-to-end · `/ai/query` cited answers meeting p95 ≤8 s · eval report meeting SRS success metrics (recall@3 ≥80%, grounded ≥90%, refusal ≥95%) · failure-mode runbook. |
| **Depends on** | M1's job schema + finalize hook; M3 for worker deployment slot and monitoring; fixture corpus from `tests/fixtures/`. |

## 5. Shared Responsibilities

- Every PR reviewed by a non-author; domain owner reviews their area.
- Docs travel with code — behavior change updates its Phase 0 doc in the same PR.
- Weekly bug-triage rotation so everyone reads logs and reproduces issues.
- Each member writes their chapter of the final report and presents their domain at demos.

## 6. Cross-Cutting Interfaces (dependency map)

```
M2 (frontend) ──consumes── REST/OpenAPI ◄──produces── M1 (backend)
M1 ──enqueues── job.schema.json ──consumes── M4 (AI workers)
M4 ──needs── compute slot, secrets, monitoring ◄── M3 (infra)
M1/M2/M4 ──need── buckets/CORS/TLS/pipelines ◄── M3
All ──review via── PR rules (Doc 08 §2)
```

**Interface artifacts are versioned:** OpenAPI spec (Doc 04), queue JSON schema (`ai-service/schemas/`), `.env.example` per service. Breaking an interface without consumer sign-off fails review.

## 7. Accountability Defaults

| Situation | Default owner | Notes |
|---|---|---|
| Latency regression vs NFR | M1 | k6 evidence in sprint review |
| Upload UX bug in browser | M2 | e2e test added alongside fix |
| Deploy outage / alarm firing | M3 | Runs incident note in journals/ |
| Wrong or missing citations | M4 | Golden-set case appended |
| Unclear ownership | Whole team, 10-min standup rule | If nobody owns it, it becomes a documented decision, not ambient work |
