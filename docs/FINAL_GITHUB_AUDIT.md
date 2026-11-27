# Final GitHub audit — 27 November 2026

Repository: https://github.com/JainMehul05/NimbusVault-
Authoritative starting main: `93ff735075b3083ac14db82301753a02ab61d5c2`
Application checkpoint included: completed Session C `ef9872c0f56daa5fc68ad408023d4ed3a7ab498b`, imported into `code/` with documented layout adaptations. Original source inventory and migration recovery use Session B `e195e9d` as their historical baseline. This report accompanies the final audit commit; the exact resulting remote hash and Actions state are verified after publication in the completion response and private remote-verification record.

## Protected academic submissions

The owner manually corrected all three directories after the structural release. They are read-only for this audit; earlier recovery instructions are superseded. No report, source, asset, README or ignore file inside these directories is changed.

| Directory | Before tree ID | Publication requirement |
|---|---|---|
| `project-proposal/` | `12fd0ba50fd6de57784bd79b4721065b98b57435` | Must remain identical |
| `project-report-final/` | `fca5082c1afab5e4f05112e4c3604eb337d49489` | Must remain identical |
| `project-report-prototype-stage/` | `9e517f433b775b6f6dc72e70b352d4d502a1f550` | Must remain identical |

The proposed index and commit are compared with freshly fetched remote `main` immediately before publication. Publication aborts if any protected tree differs; actual remote trees are checked again after the push. The current proposal PDF has 14 pages and the current prototype PDF 17 pages; both opened and extracted successfully without credential-pattern findings. The final-report directory contains only `.gitignore`; the proposal has a `.gitiggnore` spelling. These are reported, not corrected. Original journal entries remain unrecovered; recovery-status pages and clearly labelled examples are preserved.

## Source and organization audit

[Complete source inventory](application-source-audit.json) accounts for all **401** baseline application paths. Frontend 88, backend 116, intelligence 27, infrastructure 2, CDK infra 22, deployment 26, scripts 81, benchmarks 5, browser tests 9, samples 1 and config 5 files are present, plus application-level manifests/configuration/launchers. No duplicate root application exists. [Migration record](repository-file-migration.json) records prior source locations.

**Defect recovered:** `*.sql` in the root ignore rules excluded three required Prisma migration sources during relocation. Restored byte-for-byte from `e195e9d`:

- `code/backend/prisma/migrations/0_init/migration.sql`
- `code/backend/prisma/migrations/20261123000000_security_fixes_and_ai_documents/migration.sql`
- `code/backend/prisma/migrations/20261125000000_phase5_hardening/migration.sql`

A narrow migration-source exception now retains these without allowing private database dumps. Fresh-clone verification must include these files. Application code beyond those exact recovered source files is not replaced with concurrent development work. Twenty-eight previously adapted paths differ from the baseline for documentation/report destinations and application subdirectory guidance; the inventory lists them.

| Area | Implementation inspected |
|---|---|
| Frontend | `code/frontend/src/`: authentication, dashboard, files/sharing, Ask/search/citations, infrastructure, settings and responsive tests |
| Backend | `code/backend/src/modules/`: auth, users, files, folders, sharing/share-links, trash, activity, maintenance and AI; Prisma schemas/migrations; integration tests |
| Retrieval | `code/intelligence/app/embeddings.py`, `retrieval.py`, `search.py`, `database.py`: normalized MiniLM 384D embeddings, cosine/vector retrieval, SQLite/FTS5, BM25/hybrid |
| RAG | `rag.py`, `llm.py`, `internal.py`: scoped retrieval, conversation context, citation/quotation validation, abstention and Ollama/Qwen; existing tests retained |
| Operations | Five `.bat` files, `code/scripts/launcher.ps1`, platform/setup/start/stop, AWS controllers, deployment and backup source |

The completed Session C checkpoint became available during this audit after the initial `997b8fc` structural audit was published. It is now integrated and verified through the university mapping; no uncommitted development files were copied. [Provider status](AI_PROVIDER_STATUS.md) and [checkpoint mapping](session-c-source-migration.json) identify the exact provenance. Session C reports backend 313, frontend 63 and Python 97; rerun publication checks are distinguished below.

## AWS source coverage and deployment scope

The published source includes `code/infrastructure/` CloudFormation/worker definitions, `code/infra/` CDK and Lambda sources, `code/deployment/` Linux Compose/Dockerfiles/host units, `code/scripts/` AWS controllers and `code/intelligence/app/` AWS integrations.

| Service group | Source/evidence scope |
|---|---|
| EC2, EBS, VPC, IAM, STS, SSM/Session Manager, Parameter Store | Host deployment, restricted access, account checks, instance roles and administration scripts; Session A/B deployment evidence |
| API Gateway, VPC Link, Cloud Map | Public endpoint configuration/readiness; Cloud Map is service discovery, not a proxy |
| S3, EventBridge, SQS/DLQ, Lambda, Step Functions, DynamoDB | Bounded native document workflow and private reconciliation; historical/CDK alternatives are retained separately |
| S3 Vectors | Bounded synthetic demonstration; normal hybrid retrieval uses local vectors |
| CloudWatch, CloudTrail | Diagnostics and retained stop/event evidence; not every observability component is provisioned by every template |
| CloudFormation, CDK | Infrastructure definitions; presence does not imply every stack was deployed |
| Scheduler and host safeguards | External stop, host deadline, runtime timer, credit watchdog and fail-closed plan/session checks retained |
| CloudFront / KMS | CloudFront public distribution was not deployed. SecureString uses AWS-managed KMS encryption; no custom KMS-key deployment is asserted |

The public URL matches Session B documentation: https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com . Availability is bounded by authorized sessions; this audit does not start the instance or call AWS. Older Session A/B descriptions in retained reports are historical, not current uptime statements. Session C reports EC2 stopped at 16:24 UTC; that is recorded evidence, not a fresh cloud read by this audit.

## Checks actually rerun in the isolated publication checkout

| Check | Result |
|---|---|
| Backend and frontend build | PASS |
| Backend/frontend lint | PASS |
| Frontend Vitest | 63 tests passed, 15 files after Session C import |
| Infrastructure Vitest | 22 tests passed |
| AWS launcher mocked safety tests | 10 passed; no AWS calls |
| Docker launcher mocked readiness/timeout | Two checks passed; real Docker untouched |
| Python Groq provider, account guard and SDK transport tests | 25 passed; synthetic/mock transports; full isolated suite recorded in final completion evidence |
| Python source syntax | 70 files parsed |
| PowerShell syntax | 23 files parsed |
| Platform Node script syntax | PASS |
| Docker Compose | Three configurations validated; no containers started |
| Academic PDFs | Opened/read only; 14 and 17 pages, no credential-pattern matches |
| New README links and generated site | 40 README local links and 4,235 generated site links checked; zero missing targets |
| MkDocs | Clean build passed; academic filenames updated outside protected folders |
| Mermaid architecture diagrams | Both rendered to SVG/PNG with Mermaid in headless Edge and visually reviewed |

Backend database/integration suites, real-Qwen generation and browser-to-application acceptance are not rerun locally because they require separately configured services/runtime. A private isolated MiniLM copy permits offline Python regression without changing the active application. Existing CI retains those applicable service-backed checks. This audit does not claim a fresh full setup, live launcher demonstration, new AI benchmark, current public-site health or completed cloud acceptance. Historical measured performance remains labelled in the README.

## README and documentation improvements

Replaced the root README with a coherent academic overview: verified team/supervisor, actual academic filenames, feature/technology tables, application/RAG and AWS Mermaid diagrams, correct service discovery, deployment URL, measured benchmark distinctions, curated existing synthetic screenshots, prerequisites and all five launchers, security/cost limits, repository tree and documentation links. No fabricated screenshot or duplicate image was added. Linked dashboard, cited answer and cloud screenshots were visually inspected; they show synthetic demonstrations, no credentials or invitation codes. The screenshot credits/status are historical evidence, not live account statements.

Fixed academic download navigation to the owner's actual filenames without touching the reports. Added current AI-provider and protected-tree records, marked older structural records and phase plans as historical, and replaced the obsolete recovery-hash layout check with owner-managed tree checks. Historical recovery hashes remain available as provenance, not an instruction to restore older files.

The official UCS503P template remains at inspected HEAD `2cd8dba362da1b5178d03fe04b4f499b41525436`. Root configuration, `assets/`, journals, licensing scope and upstream attribution are preserved. Extra root `.gitattributes`, `LICENSE.template` and `uv.lock` serve integrity, attribution and reproducibility. No arbitrary licence is imposed.

## Security and publication

The proposed tracked tree and reachable outgoing history are scanned for credential patterns and known private values, including the actual local Groq key, without displaying any values. Private runtime, environment secrets, model binaries/caches, databases, uploads, conversations, dependencies and backups remain excluded. Protected academic PDFs are read-only. Final scan counts/findings, remote clone hashes and Actions state are recorded after checks complete; no claim of completed checks is based on a local commit alone.

A normal push must preserve remote ancestry and all three protected tree IDs. No force push, history rewrite, branch/tag deletion, active application modification, desktop-shortcut change or AWS operation is authorized or performed in this audit.

Pre-publication security result: 1,268 proposed-index/history blobs and 14 known private values checked, zero findings. Changes after that scan only record these non-sensitive verification results; the final commit is scanned again before pushing.

## Completed Session C follow-up

While remote verification of `997b8fc` was running, the deployment agent finalized `ef9872c` and supplied completed Session C reports. The source checkout was clean. The follow-up imports all 42 changed non-root-README files through the university mapping and incorporates the original README delta into the professional university/application guides. [Exact checkpoint-to-publication mapping](session-c-source-migration.json) preserves provenance. Benchmark output paths retain the `../docs/` adaptation. No academic file is imported or changed.

Includes Groq gpt-oss-20b, owner/asker consent migration and enforcement, provider selection, transactional persistent quota ledger, provider tests, adaptive public polling, provider-aware startup, Linux Prisma engine target, SSM key-fetch/secret mount source and completed deployment/evaluation documentation. Reported Session C results: local Groq 40/40; 31 generated and nine abstentions; local median 1.24 s, p95 3.6 s; public browser samples 1.5/1.6/3.0 s; EC2 search median 7.7 ms and original accuracy; backend 313, frontend 63, Python 97. These deployment-agent measurements are not rerun cloud/AI benchmarks by this audit.

The Session C report verifies the instance stopped and cloud rule/consumer idle. The GitHub audit does not call AWS. Mobile AI and the owner-controlled Groq ZDR toggle remain pending. SecureString uses AWS-managed KMS; no separate custom KMS deployment is asserted. Academic final-report content remains absent/owner-managed and is not regenerated. Updated isolated tests, secret scans, protected tree comparison, documentation/diagram/link checks and remote verification apply to the final follow-up commit.

Final source inventory now contains **410** application files. Completed checkpoint changes are independently checked against their original Git blobs; the application-layout note, benchmark documentation-output path and integration-guide layout note need adaptation. All other imported implementation files retain the completed source bytes.

Additional CI-discovered portability defect: eight shell scripts lost executable Git modes during Windows relocation. The LocalStack ready hook consequently failed with permission denied. Restored the exact original 100755 modes for six `code/infra/scripts/*.sh` helpers, `code/scripts/localstack-init.sh` and `code/scripts/smoke-test.sh`. The initial audit CI passed backend, frontend, browser end-to-end, infrastructure and security jobs; only container startup failed on this mode defect. Final follow-up CI is checked separately.

Fresh isolated Session C checks: backend/frontend builds and lint passed; frontend 63, full Python 97 (two real-Qwen tests deliberately deselected), provider/guard subset 25 and AWS launcher mock tests 10 passed. MiniLM used an ignored isolated copied cache, with offline mode; the active cache was only read. No external model request or AWS operation was performed.

Standalone key-path check: configuration `ROOT` already resolves to `code/`, matching the Windows helper's application root. An audit-only adjustment incorrectly used its parent; that adjustment was reverted before final completion. The checkpoint configuration is preserved exactly. An independent regression assertion now resolves the actual helper file and checks that the configured key path matches its directory. The active application was never modified.

Final follow-up details: 72 Python sources parse; 24 PowerShell scripts parse; Session C Compose validates; 26 focused provider/account/SDK tests pass with the key-path regression assertion. The complete preceding isolated Python run passed 97 tests with two real-Qwen cases deselected. No new paid/provider inference was executed. Checkpoint mapping labels all intentional adaptations (four after reverting the unnecessary config adjustment) rather than claiming byte-identical modified files.

Upgrade-verification compatibility fix: adding the consent migration made the old “all except newest” fixture baseline include hardening constraints, while its legacy fixtures intentionally contain duplicate folders/invalid usage. Pinned that existing upgrade scenario to the pre-hardening migration boundary and applied hardening plus every later migration. Added verification that legacy users remain opted out of external AI. This preserves the original data-repair checks while covering the new consent migration; verification runs only against CI's empty test database.

Browser CI compatibility: one landing-page test read `locator.count()` immediately after returning from another route, before React mounted the target anchor. Replaced that immediate snapshot with Playwright's retrying `toHaveCount(1)` assertion and waited for the landing heading on return. The same anchor count, route, safety and error assertions remain; no production UI behavior or acceptance criterion was removed.

The actual corrected landing-page Playwright test passed against the isolated compiled frontend in headless Edge (10.5 s total); anonymous health/auth HTTP responses were mocked for this UI-only check. Full service-backed browser regression is verified separately by final CI.
