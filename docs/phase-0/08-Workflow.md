# NimbusVault — Repository & Development Workflow Document

| Field | Value |
|---|---|
| Document | Phase 0 · 08 — Repository Design, Standards, AI-Assistant Policy |
| Repo model | Monorepo — atomic cross-service changes (e.g., API contract + client types) in one PR |
| Version | 1.0 |

## 1. Monorepo Structure

```
NimbusVault/
├── frontend/                    # React SPA (Member 2)
│   ├── src/
│   │   ├── features/            #   auth/ drive/ preview/ sharing/ search/ ai-chat/
│   │   ├── components/          #   shared UI primitives
│   │   ├── lib/api/             #   typed API client generated from OpenAPI
│   │   └── app/                 #   router, providers, layout shell
│   └── e2e/                     #   Playwright specs
├── backend/                     # NestJS API (Member 1)
│   ├── src/
│   │   ├── modules/             #   auth/ files/ folders/ shares/ search/ ai-proxy/
│   │   ├── common/              #   guards, interceptors, filters, rate-limiters
│   │   └── infra/               #   prisma service, s3 client, queue producers
│   └── prisma/                  #   schema.prisma + migrations/
├── ai-service/                  # Python FastAPI (Member 4)
│   ├── app/
│   │   ├── pipelines/           #   extract.py chunk.py embed.py retrieve.py rag.py
│   │   ├── workers/             #   BullMQ consumer
│   │   └── api/                 #   routers, schemas
│   ├── adapters/                #   vectorstore/ llm/  ← swappable backends
│   ├── eval/                    #   golden QA sets + recall@k harness
│   └── schemas/                 #   queue job contracts shared with backend
├── infrastructure/              # Cloud & CI (Member 3)
│   ├── docker/                  #   Dockerfile per service
│   ├── docker-compose.yml       #   full local stack (pg, redis, minio, services)
│   └── aws/                     #   IAM policies, bucket policies, provisioning notes
├── tests/                       # Cross-service test assets
│   ├── e2e/                     #   golden-path suites (register→upload→share→ask)
│   ├── load/                    #   k6 scenarios mapped to NFR targets
│   └── fixtures/                #   sample corpus for AI evaluation
├── docs/                        # MkDocs documentation site
│   └── phase-0/                 #   this planning set
├── .github/workflows/           # CI pipelines (lint → test → build → deploy)
├── journals/                    # Individual engineering journals
└── README.md                    # Product overview + quickstart
```

**Folder responsibilities in one line each:** `frontend` owns user experience · `backend` owns business truth · `ai-service` owns document intelligence · `infrastructure` owns reproducibility (local and cloud) · `tests` owns confidence across service boundaries · `docs` owns institutional memory.

**Boundary rules**

1. Services never import each other's source code; they communicate via HTTP or queue messages only.
2. `ai-service/schemas/` and the OpenAPI spec are *versioned interfaces* — changes need consumer review.
3. Every service ships a Dockerfile and `.env.example`; nothing runs "only from someone's laptop".
4. `docker compose up` boots the entire system offline (MinIO substitutes S3; LLM adapter has an offline stub).

## 2. Git Workflow

```
main        ← production. Protected: no direct commits, ever. Deployable.
develop     ← integration. Protected: PRs only. Always-green expectation.
feature/*   ← one concern per branch, cut FROM develop
fix/*       ← bug fixes
hotfix/*    ← production emergencies: cut from main, merged to main AND develop
```

**Rules (non-negotiable)**

1. **Pull requests required** for every change — no exceptions, including docs and config.
2. **Code review before merge**: one approving review from someone other than the author; domain owner reviews their area (M1 → backend, M2 → frontend, M3 → infra, M4 → AI).
3. **No direct commits to `main` or `develop`** — branch protection enforces this technically.
4. CI must be green before human review begins; red PRs are not reviewed.
5. Branch naming: `feature/auth-registration`, `feature/file-presigned-upload`, `fix/quota-race-on-finalize`.
6. Commits follow **Conventional Commits**: `feat(auth): add refresh rotation` — CI rejects non-conforming subjects.
7. Rebase feature branches onto fresh `develop` to resolve conflicts; the reviewer merges; force-pushing shared branches is forbidden.

**Merge strategy**

| Path | Strategy | Why |
|---|---|---|
| feature/fix → develop | Squash merge | One coherent commit per concern |
| develop → main | Merge commit + tag (`v0.x.y`) at sprint close | Preserves sprint narrative; tags mark demos |
| hotfix → main + develop | Merge both | Fixes can't silently miss integration |

PR template requires: what/why · test evidence · doc impact · screenshots for UI · `ai-assisted` label when applicable (see §4).

## 3. Code Style & Documentation Standards

### Frontend
- ESLint (typescript-eslint + react-hooks + react-a11y plugins) and Prettier run as pre-commit hooks and CI gates; formatting debates are settled by the machine.
- Function components + hooks only; prop types via TypeScript interfaces; feature folders own their state (TanStack Query keys namespaced per feature).
- No inline styles alongside Tailwind utilities except dynamic values.

### Backend (NestJS/TypeScript)
- Strict TypeScript (`strict: true`, no implicit any); DTO classes with class-validator decorators on every public endpoint.
- Layering enforced by lint boundaries: controller → service → repository/prisma; controllers contain no business logic.
- Explicit return types on exported functions; `any` requires an inline justification comment.

### Python (ai-service)
- Ruff (lint+format) with strict isort; Pydantic models for all external contracts; type hints required on public functions (mypy advisory initially).

### Documentation standards
- **Every API endpoint documented** — the OpenAPI spec generated from decorators is authoritative; CI fails on drift between spec and Doc 04.
- Every service README covers: purpose, env vars table, run/test commands.
- Behavior changes update the affected Phase 0 document in the same PR ("docs travel with code").
- ADRs (Doc 05 §10) appended for any dependency addition or architectural reversal.

---

## 4. Claude Code Usage Guidelines (AI-Assisted Development Policy)

Claude Code (and comparable AI coding assistants) is treated as a **junior pair-programmer**: fast, tireless, and always supervised. It accelerates the team; it never governs it.

### Permitted uses

| Use | Examples |
|---|---|
| Boilerplate generation | Module scaffolds, DTO/validation shells, docker-compose entries, test file skeletons, Tailwind component stubs |
| Refactoring | Renames, extracting duplicated logic into helpers, applying lint fixes across files |
| Documentation | Drafting JSDoc/docstrings, README sections, changelog entries from merged PRs |
| Debugging assistance | Explaining stack traces, proposing hypotheses for failing tests, suggesting targeted experiments |
| Learning support | Explaining unfamiliar APIs/prisma/queue semantics before use |

### Prohibited without explicit human approval (recorded in the PR)

1. **Architecture decisions** — module boundaries, service splits, data-flow changes. AI may *draft options*; humans decide via ADR.
2. **Adding/removing libraries or dependencies** — every dependency is justified in an ADR note and reviewed for maintenance/licensing.
3. **Database schema changes** — any `schema.prisma` edit or migration requires Member 1's authored design + review; AI may only draft after the design exists.
4. **Security-critical code** — auth flows, token handling, IAM/bucket policies, rate limiters are human-authored line-by-line.
5. **Secrets handling** — never paste credentials, tokens or `.env` contents into any prompt.

### Mandatory requirements for every generated artifact

- **Reviewed** — owning member reads every line; AI output receives the same review scrutiny as human code, with reviewers told (via label) to be extra skeptical.
- **Tested** — the change must pass existing suites and carry tests proving the behavior; "the AI said it works" is not evidence.
- **Explained** — the committing member must be able to defend the code in review: what it does, why it is correct, what it breaks under failure. If you cannot explain it, you cannot merge it.
- **Attributed** — PR description notes which parts were AI-assisted and how they were verified.
- **Integrated, not pasted** — generated code is adapted to project conventions (naming, layering, error envelope) before the PR opens.

### Anti-goal this policy prevents
Skill atrophy and unreviewable complexity. The team's goal is demonstrable engineering competence: every member can explain 100% of the codebase in a viva or interview. AI compresses typing time — never understanding time.
