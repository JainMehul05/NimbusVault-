# NimbusVault — Development Roadmap

| Field | Value |
|---|---|
| Document | Phase 0 · 11 — Development Roadmap |
| Horizon | 16 weeks · 8 sprints of 2 weeks · demo closes every sprint |
| Working agreements | Workflow per Doc 08 · testing gates per Doc 09 · DoD below |

## 1. Definition of Done (every feature)

Merged with green CI · unit+integration tests added/updated · OpenAPI or job-schema updated if interfaces changed · activity-log emitted for mutations · structured logs carry request IDs · affected docs revised · demonstrated on staging.

## 2. Phased Delivery Plan

> A phase closes when its acceptance criteria pass **live on staging** — not when code exists on a laptop.

### Phase 0 — Planning & Architecture (Weeks 1–2) ✅ *this document set*
Six-plus planning docs · repo scaffold with CI running lint/tests on skeleton services · docker-compose boots empty shells · AWS account secured (MFA, budgets) · branch protection active.
**Exit:** team can name the contract, the schema and their first sprint's stories without opening an IDE.

### Phase 1 — Storage Foundation (Weeks 3–6)
Auth end-to-end (register/login/refresh/logout/profile) · two-phase presigned upload + finalize + orphan reconciliation · list/get/rename/move/delete/restore · folders CRUD + tree browse · metadata search · minimal drive UI (uploader, grid/list, breadcrumbs).
**Acceptance:** register→upload 20 files→organize→trash→restore works on staging · p95 metadata ≤300 ms under k6 demo profile · migration history clean through Doc-03 §7 pipeline.

### Phase 2 — Sharing & Previews (Weeks 7–8)
Share links (permission/expiry/password/cap/revocation) · public redemption page · PDF/image/video previews via range-capable presigned URLs · trash UI + nightly purge · activity feed v1.
**Acceptance:** VIEW link cannot download · expired ⇒ `410` · password link challenges correctly · CloudWatch shows zero byte-throughput on API during a 50 MB video preview.

### Phase 3 — Cloud Hardening (Weeks 9–10)
CloudFront for assets/downloads · least-privilege IAM audit vs Doc 06 matrix · dashboards + alarms wired to team channel · backup/restore drill executed (RTO ≤4 h evidence) · load-test report vs NFR table · security sweep (rate limits, headers, dependency audit, gitleaks).
**Acceptance:** simulated failure restored within target; alarms page within 5 minutes; report attached to release notes.

### Phase 4 — AI Foundation (Weeks 11–13)
Queue consumer in ai-service · extraction for all supported types · chunking + embedding into ChromaDB · indexing status surfaced in UI (`aiStatus` lifecycle) · semantic search endpoint + results UI · eval harness baseline over golden set.
**Acceptance:** uploaded lecture PDF reaches INDEXED ≤60 s · recall@3 ≥80% on golden questions · failed jobs visible and reindexable · eval trends published each sprint.

### Phase 5 — AI Assistant (Weeks 14–15)
`/ai/query` RAG endpoint with citations · chat panel with source chips (open-to-page) · low-confidence refusal behavior · whole-library scope mode · rate limits tuned · eval gates promoted to CI-blocking.
**Acceptance:** every answer cites verifiable sources at correct pages · out-of-corpus questions refused ≥95% · p95 end-to-end ≤8 s.

### Phase 6 — Polish & Release (Week 16)
E2E suite hardening · accessibility pass · empty/error states · final security checklist · docs site freeze · demo-script rehearsal · report chapters assembled from journals · tag `v1.0.0`.

## 3. Sprint Cadence

| Day | Ritual |
|---|---|
| Day 1 | Sprint planning: pull from phase backlog only; stories carry acceptance criteria from these docs |
| Daily | Async standup: done / next / blocked (+ metrics glance: alarms, queue depth, cost) |
| Day 10 | Demo on staging against acceptance criteria → retro → tag `v0.x` |

## 4. Milestone RACI

| Deliverable | M1 Backend | M2 Frontend | M3 Cloud | M4 AI |
|---|---|---|---|---|
| Auth module | **A/R** | R (UI) | C | I |
| Upload pipeline | **A/R** | R | C (S3/CORS) | C (job contract) |
| Drive browser UI | C | **A/R** | I | I |
| Share system | **A/R** | R | C | I |
| Infra/CI/deploy | C | C | **A/R** | R (ai-service lane) |
| Extraction/indexing | C | I | C | **A/R** |
| RAG assistant | C (proxy) | R (chat UI) | I | **A/R** |
| Docs & final report | R | R | R | R |

*A=Accountable · R=Responsible · C=Consulted · I=Informed*

## 5. Risk Register

| # | Risk | P | Impact | Mitigation | Trigger → response |
|---|---|---|---|---|---|
| R1 | AWS credits exhausted mid-project | M | High | Budget alarms day 1; MinIO parity stack; per-sprint cost review | 80% alert → downsize instances, cap AI spend |
| R2 | LLM provider outage/cost spike near demos | M | High | Adapter interface; cached answers for scripted queries; Ollama fallback rehearsed once in Phase 4 | Provider 5xx → env-var adapter switch, offline demo path |
| R3 | Two-phase upload defects (orphans, stuck UPLOADING) | H | Med | Reconciliation job; state machine; MinIO integration tests | Orphans >0.5% → tune TTLs + alarm |
| R4 | Availability dips (exams season) | H | Med | Domain isolation by design; weekly pairing; docs keep context transferable | Planned absence → pre-agreed handoff note |
| R5 | Retrieval quality underperforms | M | High | Eval harness from week 11, not week 15; chunking experiments tracked | recall@3 <80% at Phase-4 close → narrow scope to per-file QA mode |
| R6 | Scope creep (collab editing, versioning asks) | H | Med | Non-goals frozen in SRS §1.5; new asks require ADR + timeline impact | Any request → team vote; default is no |
| R7 | AI-assisted code merged unreviewed | M | Med | Doc 08 §4 policy: label, review, tests, explain-or-reject | Any violation → PR reverted, retro item |

## 6. Release & Versioning

SemVer: `v0.x` through Phase 5 (breaking changes allowed with consumer sign-off), `v1.0.0` at Phase 6. Every tagged release ships notes: features, known issues, eval numbers, cost snapshot, restore-drill status.
