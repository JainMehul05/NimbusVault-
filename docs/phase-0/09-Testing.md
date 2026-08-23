# NimbusVault — Testing Strategy Document

| Field | Value |
|---|---|
| Document | Phase 0 · 09 — Testing Strategy |
| Philosophy | Tests are the team's memory: they encode agreed behavior, catch regressions, and let four students refactor without fear |
| Version | 1.0 |

## 1. Test Pyramid & Gates

```
        /\        E2E (few, golden paths)          Playwright
       /  \       Integration (API + real deps)    Supertest · pytest + docker-compose
      /____\      Unit (many, fast, isolated)      Jest · Vitest · pytest
     /______\     Static (every commit)            tsc strict · ESLint/Ruff · OpenAPI diff
```

| Level | CI behavior |
|---|---|
| Static | Every push — blocking |
| Unit | Every PR — blocking (≥70% coverage on backend core modules) |
| Integration | Every PR — blocking; runs against real Postgres/Redis/MinIO via docker-compose |
| E2E | Nightly + PRs touching golden paths — blocking on failure |
| Load / Eval | Sprint-end advisory (Phase 1–3) → release-blocking thresholds (Phase 4+) |

## 2. Backend Testing (Member 1)

**Unit — services in isolation.** Business logic tested with mocked repositories: quota arithmetic and overflow rejection · share-link validity predicate (expiry/revocation/cap combinations) · token issuance claims (`sub`, `jti`, `exp`) · filename ranking order (exact > prefix > substring). Fast (<5 s), no I/O.

**Integration — API against real dependencies.** Supertest drives the NestJS app wired to live Postgres/Redis/MinIO containers:
- Auth lifecycle: register → login → refresh → reuse-rotated-refresh (must revoke family) → logout → denylisted token rejected.
- Two-phase upload: presign constraints honored → PUT to MinIO → finalize HEAD-verifies → wrong-size finalize returns `422` → orphan reconciliation job deletes abandoned objects.
- Folder tree: sibling-name conflict `409` · cycle move rejected · recursive soft delete + restore.
- **Tenant isolation suite:** two seeded users; every read path (metadata, presign, search, semantic, RAG proxy) asserts cross-access yields `404`/refusal. This suite can never be skipped or weakened.

## 3. Frontend Testing (Member 2)

**Component tests (Vitest + React Testing Library).** Uploader states (progress/retry/pause), file-grid interactions, share dialog validation, AI chat citation rendering, empty/error/loading triads.

**E2E golden paths (Playwright, nightly).** Register → upload 3 files → browse folders → rename/move → search by name → share with expiry+password → redeem link in a fresh context → ask AI a question → verify cited answer renders. Runs against staging-like compose stack.

**Accessibility & performance gates.** axe scan on primary screens (zero critical violations); Lighthouse ≥85 performance on drive page.

## 4. Cloud / Infrastructure Testing (Member 3)

- **S3 contract tests:** presigned PUT enforces content-type/length (violations must fail); expired URLs return 403; versioned bucket recovers an overwritten object; lifecycle rule expires trash objects (verified with shortened rule on test bucket).
- **Pipeline tests:** CI builds images once, deploys to staging, runs smoke checks (`/health/ready` green, upload round-trip).
- **Backup/restore drill (Phase 3 gate):** scripted disaster — restore Postgres from nightly backup into clean instance, reattach bucket policy, verify RTO ≤ 4 h with checklist evidence.
- **Config audits as tests:** IAM policy linting (no wildcard actions on sensitive services); gitleaks secret scanning on every push.

## 5. AI Testing (Member 4)

**Extraction/chunking unit tests.** Each supported type has fixture documents asserting extracted text fidelity (headings, multi-column PDFs, tables-as-text) and chunk properties: size bounds, overlap presence, section-boundary respect, stable ordering.

**Retrieval accuracy — evaluation harness.**
- Golden set: ~100 question/answer-source pairs authored over the fixture corpus (lecture notes, reports, spreadsheets).
- Metrics per run: **recall@k** (correct chunk in top-k; target ≥80% at k=3 for semantic search), grounding rate (≥90% of answers cite real retrieved chunks), refusal correctness (≥95% of unanswerable questions refused rather than fabricated).
- The harness runs in CI on every ai-service PR; results trend on a dashboard. Advisory during Phase 4; blocking thresholds from Phase 5.
- Regression discipline: every retrieval bug fixed adds its failing case to the golden set.

**RAG answer quality.** Small human-judged sample each sprint: citations point at genuinely supportive passages; injected-document instruction attacks ("ignore previous instructions…") produce refusals or neutral summaries, never compliance.

## 6. Test Data & Environments

| Environment | Data | Rules |
|---|---|---|
| local (compose) | Deterministic fixtures (seed script) | No real user data ever |
| staging | Synthetic only | Free rein for destructive tests, load runs, drills |
| production | Real data | No tests except read-only smoke checks post-deploy |

Fixtures are committed under `tests/fixtures/` so any member reproduces any failure deterministically. Flaky tests are quarantined within 24 h and fixed or deleted — a red suite nobody trusts is worse than no suite.

## 7. Bug Process

Reproduce first (add failing test that captures it) → fix → test proves recovery → root cause noted in PR. Severity S1 (data loss/isolation/security) halts feature work until resolved.
