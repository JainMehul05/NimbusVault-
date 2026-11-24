# NimbusVault final engineering report

Date: 2026-11-25 · Branch: `phase-5-production-readiness` · Verified commit: `dd49556` (this report and any later commit change documentation only)

Labels: **PASSED** executed and successful · **FAILED** executed and unsuccessful · **BLOCKED** could not execute · **NOT TESTED** not attempted · **IMPLEMENTED** code exists, runtime verification incomplete · **DEFERRED** intentionally postponed.

Environments: **Local** = this Windows 11 machine (Node 24; no Docker, WSL or PostgreSQL) using substitutes: PGlite (PostgreSQL compiled to WASM, with pgvector) and moto (S3 API). **CI** = GitHub Actions, Ubuntu, Node 22, real PostgreSQL 16 + pgvector, LocalStack 3.5, Docker. CI run: [45494074637](https://github.com/JainMehul05/NimbusVault-/actions/runs/45494074637).

## 1. Executive summary

- Phases 1–4 are complete and verified in one repository. The separate implementation was already in `main`; only eight dead files differed.
- Phase 5 is implemented (AWS CDK, production containers, CI/CD, monitoring, runbooks) and validated as far as possible without an AWS account.
- 16 security or data-safety findings were fixed, including one critical (quota bypass) and six high. No critical or high finding remains open.
- Several defects meant advertised features could not work: silent token refresh always failed in the browser, every Anthropic request would have been rejected, Compose download links pointed at an unreachable host, and running the tests erased the development database.
- All automated checks pass. **Not proven:** anything on real AWS, and answers from a live hosted LLM.

## 2. Original architecture

React SPA and Express API in an npm workspace; Prisma on PostgreSQL 16/pgvector; S3 through AWS SDK with static keys; AI worker inside the API process; JWT and bcrypt-hashed refresh tokens, both kept in `localStorage`; development-only Dockerfiles; CI with lint, tests and builds; no browser tests and no infrastructure code. Baseline before changes (Local): 169 backend and 21 frontend tests passing, lint clean.

## 3. Integrated architecture

Same modular monolith, with a separate worker process, trash and maintenance modules, server-side sessions, cookie transport, production images, an `e2e` workspace and an `infra` workspace. See [architecture](docs/guides/architecture.md) and [AWS architecture](docs/phase-5/aws-architecture.md).

## 4. Status by phase

| Phase | Status |
|---|---|
| 1 Authentication | PASSED (Local, CI) |
| 2 Storage | PASSED (Local, CI). Against real Amazon S3: DEFERRED |
| 3 Sharing and activity | PASSED (Local, CI) |
| 4 Document intelligence | PASSED for extraction, OCR, local embeddings, search, isolation, provider failures. Live hosted LLM: BLOCKED (no API key) |
| 5 Infrastructure and delivery | IMPLEMENTED; synthesis, tests, security rules, containers PASSED. Deployment: DEFERRED |
| 6 | Not started, as instructed |

## 5–7. Files

Between `0334c12` and the verified commit: 97+ files added, about 90 modified, 9 removed. The exact list is `git diff --name-status 0334c12..HEAD`; a grouped list is in the [integration report](docs/release/integration-report.md).

| Removed | Reason |
|---|---|
| `frontend/src/components/{FileItem,FileList,SearchBar,StorageIndicator,UploadZone}.tsx`, `frontend/src/hooks/{useActivity,useShareLinks,useSharing}.ts` | Dead code, already removed in the separate implementation |
| `backend/prisma/schema.prisma.bak` | Accidental copy |

## 8. Integration conflicts

| Conflict | Resolution |
|---|---|
| The brief left the separate folder's path blank, and no `NimbusVault-verified` folder exists | Compared every copy on the machine. `NimbusVault--main-backup` is the separate implementation; this repository is the canonical one |
| `.gitignore` | Kept the repository version (the other would hide migrations) |
| Anything else | None; sources were identical |

Two intentional test changes followed behaviour changes and were made stricter, not weaker: the presigned-upload test now goes through completion instead of inserting a row by hand, and the expired-link test also asserts that expired links cannot be created. URL lifetimes compare with configuration instead of `3600`.

## 9. Backend verification

| Check | Local | CI |
|---|---|---|
| Lint, types (sources and tests) | PASSED | PASSED |
| 283 tests in 11 suites | PASSED | PASSED |
| Concurrency (quota, rotation, downloads, names, folder moves, job claims) | PASSED on a single-connection engine, so weak evidence | PASSED on real PostgreSQL |
| Production build starts as API and worker, reports ready, stops on SIGTERM | NOT TESTED | PASSED |
| Insecure production settings refused | PASSED (unit) | PASSED (process) |

## 10. Frontend verification

| Check | Local | CI |
|---|---|---|
| Lint, types, production build | PASSED | PASSED |
| 55 tests in 13 files | PASSED | PASSED |
| Build in isolation from other workspaces (Docker) | PASSED after a fix | PASSED |

## 11. Browser testing

28 Playwright tests on Chromium against production builds. CI: PASSED (full run). Local: 27 of 28 in the last full run; the one failure was an ambiguous selector in the test, corrected and re-run on its own: PASSED.

| Workflow | Result |
|---|---|
| 1 Registration → sign-in → dashboard | PASSED |
| 2 Upload → index → semantic search (real MiniLM) | PASSED |
| 3 Upload → download → delete (→ restore → purge) | PASSED |
| 4 Nested folders | PASSED |
| 5 Share → access → revoke | PASSED |
| 6 Share link → password → download | PASSED |
| 7 Link expiry and download limit | PASSED |
| 8 Owner, Editor, Viewer, stranger | PASSED |
| 9 AI cross-user isolation | PASSED |
| 10 Activity authorization | PASSED |
| 11 Refresh rotation, several tabs, token replay | PASSED |
| 12 Failed upload and quota restoration | PASSED |

15 pages at 390, 768 and 1440 px: no horizontal overflow, no console errors: PASSED. Screenshots of representative pages were inspected by eye, which is how the unstyled landing-page button and logo were found. Firefox, Safari and real phones: NOT TESTED. Automated accessibility audit (axe): NOT TESTED.

## 12. Database migrations

| Check | Local (PGlite) | CI (PostgreSQL 16) |
|---|---|---|
| Fresh install | PASSED | PASSED |
| Schema drift | PASSED (none) | PASSED (none) |
| Upgrade of a populated older schema, every row kept | PASSED | PASSED |
| HNSW index usable and returning the same results as exact search | PASSED | PASSED |
| Your own existing data | NOT TESTED (no database on this machine) | |

## 13. Docker and LocalStack

Local: BLOCKED (Docker and WSL are not installed, and there are no administrator rights). CI: all PASSED: both images build; the six-service stack becomes healthy; smoke test through nginx (register, upload, download through the browser-facing URL, indexing by the separate worker, search, delete); recreation keeps PostgreSQL data; containers are unprivileged; the model loads with networking disabled and a read-only filesystem; Trivy finds no fixable critical vulnerability. Community LocalStack does not persist objects across recreation (documented).

## 14. AI providers

| Check | Result |
|---|---|
| Local all-MiniLM-L6-v2, 384 dimensions | PASSED |
| Relevance: 5 paraphrased queries over 5 documents, right document first; unrelated query below 0.4 | PASSED 5/5 (a smoke check, not a benchmark) |
| OCR of a scanned PDF (tesseract.js, local) | PASSED |
| OpenAI-compatible and Anthropic wire protocol, bad credentials, rate limits, outages, timeouts, malformed replies, redirects, refusals (against a local HTTP server) | PASSED |
| No generation provider: clear 503 and notice, no invented answer | PASSED |
| Live OpenAI or Anthropic call | BLOCKED (no key) |

Document text goes to a third party only when a hosted generation or embedding provider is configured, and the interface says so. The Anthropic client remains the project's existing provider-neutral HTTP implementation rather than the vendor SDK.

## 15. Security audit

Full table and accepted residual risks: [docs/guides/security.md](docs/guides/security.md). Highlights, all fixed and covered by tests: presigned-upload quota bypass (critical); tokens in `localStorage`; non-atomic refresh rotation; access tokens valid after sign-out; editors' links outliving their access; the test suite erasing the development database; vulnerable dependencies. The previously reported activity IDOR was re-tested and stays closed.

Dependencies: 30 advisories (4 critical, 11 high) at the start; shipped dependencies now 0. Development-only tools: 6 moderate (typescript-eslint 7 chain). Secret scan of the diff and repository: PASSED. This was an internal review, not an independent penetration test.

## 16. Test totals

| Suite | Before | After | Result |
|---|---:|---:|---|
| Backend | 169 | 283 | PASSED |
| Frontend | 21 | 55 | PASSED |
| Browser | 0 | 28 | PASSED |
| Infrastructure | 0 | 22 | PASSED |
| **Total** | **190** | **388** | **0 failing, 0 skipped** |

Pre-existing failures: the last completed CI run on `main` before this work (October) had failed, and the documentation workflow failed on every push because the file was empty.

## 17. Build and lint

Backend, frontend and infrastructure type checks, ESLint (0 errors, 0 warnings in the backend, down from 15 warnings) and builds: PASSED. `git diff --check`: PASSED. Documentation site builds: PASSED (Local). Workflows linted with actionlint: PASSED for `ci.yml` and `mkdocs.yml`; on `deploy.yml` the 2022 linter build only objects to the newer `vars` context.

## 18. Phase 5 architecture

CloudFront (one origin for app and API) → private S3 site and, through a VPC origin, an internal load balancer → Fargate API; Fargate Spot worker; RDS PostgreSQL 16; private versioned S3; Secrets Manager; CloudWatch alarms, dashboard and SNS; budget; ECR; GitHub OIDC. No NAT gateway, no public API address, no stored AWS keys.

## 19. Infrastructure validation

AWS CDK was chosen over Terraform because there was no existing infrastructure code and CDK can be fully checked offline.

| Check | Result |
|---|---|
| Type check, 22 unit tests | PASSED |
| Synthesis: staging, production, production with WAF, domain and Multi-AZ; with and without an account id | PASSED |
| AwsSolutions security rules | PASSED (every deviation has a written reason) |
| cfn-lint | PASSED (one informational W3005 from CDK itself) |
| Deployment scripts: syntax | PASSED |
| Deployment scripts: execution; `cdk deploy` | DEFERRED |
| TLS-verified connection to RDS | IMPLEMENTED |

## 20. CI/CD

`ci.yml`: six jobs, PASSED. `deploy.yml`: IMPLEMENTED; real deployment and rollback DEFERRED. The first CI runs of this branch FAILED in the container job (an unavailable scanner action, then a type error visible only in an isolated install); both were fixed.

## 21. Cost

About **$77 a month** for production and **$59** for staging, from list prices that were not checked against a bill: [cost.md](docs/phase-5/cost.md).

## 22. Deferred until an AWS account exists

Provisioning of every resource, RDS, ECS, production S3, CloudFront, production URL checks, live monitoring and alarm e-mails, backup restore rehearsal, OIDC deployment, real cost verification.

## 23. Remaining issues

1. Hosted-LLM answers and summaries need a try with a real key.
2. Nothing has run on real AWS.
3. No e-mail verification, password reset or multi-factor sign-in (new features, outside this scope).
4. Rate limits are per process; the application uses the database owner role on AWS.
5. Files are not virus-scanned; documents are parsed in the worker process rather than a sandbox.
6. `LICENSE` is empty; the owners should choose one.
7. The generated landing-page prototype (`nimbus-vault-landing-page-design/`) and Phase 0/1 plans are kept as history and do not describe the product.

## 24. Git

Commits on `phase-5-production-readiness`, on top of `0334c12`, pushed to `origin` without force; `main` is unchanged. Local tag `checkpoint/pre-phase5` marks the starting point. `git log --oneline 0334c12..` lists the commits. Merge through a pull request: <https://github.com/JainMehul05/NimbusVault-/pull/new/phase-5-production-readiness>.

## 25. Local set-up

```bash
git clone https://github.com/JainMehul05/NimbusVault-.git && cd NimbusVault-
git switch phase-5-production-readiness     # until it is merged
docker compose up --build                   # http://localhost:5173
```

Hot reload, or no Docker: [local development](docs/guides/local-development.md). Tests:

```bash
npm ci && npm run db:generate
docker compose up -d postgres localstack
npm run test:prepare --workspace=backend && npm test
npm run build && npm run test:e2e
npm test --workspace=infra
```

## 26. Future AWS deployment

```bash
aws sso login
export ENVIRONMENT=staging AWS_REGION=us-east-1
export CDK_CONTEXT="githubRepo=JainMehul05/NimbusVault- alarmEmail=you@example.com"
bash infra/scripts/bootstrap.sh
export IMAGE_TAG=$(git rev-parse HEAD)
bash infra/scripts/push-image.sh && bash infra/scripts/deploy.sh && bash infra/scripts/verify.sh
```

Creates paid resources; read [the guide](docs/phase-5/aws-deployment.md) and [costs](docs/phase-5/cost.md) first.
