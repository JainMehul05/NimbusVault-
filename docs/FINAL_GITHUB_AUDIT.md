# Final GitHub audit — 27 November 2026

Repository: https://github.com/JainMehul05/NimbusVault-
Authoritative starting main: `93ff735075b3083ac14db82301753a02ab61d5c2`
Application baseline included: verified Session B source `e195e9de7bc35f47ba55156751f4d6d22d64953c`, relocated under `code/` with documented path adaptations. This report accompanies the final audit commit; the exact resulting remote hash and Actions state are verified after publication in the completion response and private remote-verification record.

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

No finished Groq implementation is imported. The separate branch remains at local checkpoint `caa4548` while the deployment agent marks Session C in progress and has uncommitted deployment/UI changes. [Provider status](AI_PROVIDER_STATUS.md) records the verified local benchmark separately. User-suggested 313/63/97 test counts are not substituted for results of this published source. The latest complete deployment evidence included remains Sessions A/B; this is an explicit limitation, not a claim that newer work is absent locally.

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
| CloudFront / KMS | CloudFront public distribution was not deployed. No completed Session C KMS claim is made |

The public URL matches Session B documentation: https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com . Availability is bounded by authorized sessions; this audit does not start the instance or call AWS. Older Session A/private-host descriptions in retained reports are historical, not current uptime statements.

## Checks actually rerun in the isolated publication checkout

| Check | Result |
|---|---|
| Backend and frontend build | PASS |
| Backend/frontend lint | PASS |
| Frontend Vitest | 60 tests passed, 14 files |
| Infrastructure Vitest | 22 tests passed |
| AWS launcher mocked safety tests | 10 passed; no AWS calls |
| Docker launcher mocked readiness/timeout | Two checks passed; real Docker untouched |
| Python account guard and SDK transport tests | 11 passed; synthetic/mock transports |
| Python source syntax | 70 files parsed |
| PowerShell syntax | 23 files parsed |
| Platform Node script syntax | PASS |
| Docker Compose | Three configurations validated; no containers started |
| Academic PDFs | Opened/read only; 14 and 17 pages, no credential-pattern matches |
| New README links and generated site | 40 README local links and 4,235 generated site links checked; zero missing targets |
| MkDocs | Clean build passed; academic filenames updated outside protected folders |
| Mermaid architecture diagrams | Both rendered to SVG/PNG with Mermaid in headless Edge and visually reviewed |

Backend database/integration suites, real-model Python suites and browser-to-application acceptance are not rerun locally because they require separately configured services/models. Existing CI retains those applicable service-backed checks. This audit does not claim a fresh full setup, live launcher demonstration, new AI benchmark, current public-site health or completed cloud acceptance. Historical measured performance remains labelled in the README.

## README and documentation improvements

Replaced the root README with a coherent academic overview: verified team/supervisor, actual academic filenames, feature/technology tables, application/RAG and AWS Mermaid diagrams, correct service discovery, deployment URL, measured benchmark distinctions, curated existing synthetic screenshots, prerequisites and all five launchers, security/cost limits, repository tree and documentation links. No fabricated screenshot or duplicate image was added. Linked dashboard, cited answer and cloud screenshots were visually inspected; they show synthetic demonstrations, no credentials or invitation codes. The screenshot credits/status are historical evidence, not live account statements.

Fixed academic download navigation to the owner's actual filenames without touching the reports. Added current AI-provider and protected-tree records, marked older structural records and phase plans as historical, and replaced the obsolete recovery-hash layout check with owner-managed tree checks. Historical recovery hashes remain available as provenance, not an instruction to restore older files.

The official UCS503P template remains at inspected HEAD `2cd8dba362da1b5178d03fe04b4f499b41525436`. Root configuration, `assets/`, journals, licensing scope and upstream attribution are preserved. Extra root `.gitattributes`, `LICENSE.template` and `uv.lock` serve integrity, attribution and reproducibility. No arbitrary licence is imposed.

## Security and publication

The proposed tracked tree and reachable outgoing history are scanned for credential patterns and known private values, including the actual local Groq key, without displaying any values. Private runtime, environment secrets, model binaries/caches, databases, uploads, conversations, dependencies and backups remain excluded. Protected academic PDFs are read-only. Final scan counts/findings, remote clone hashes and Actions state are recorded after checks complete; no claim of completed checks is based on a local commit alone.

A normal push must preserve remote ancestry and all three protected tree IDs. No force push, history rewrite, branch/tag deletion, active application modification, desktop-shortcut change or AWS operation is authorized or performed in this audit.

Pre-publication security result: 1,268 proposed-index/history blobs and 14 known private values checked, zero findings. Changes after that scan only record these non-sensitive verification results; the final commit is scanned again before pushing.
