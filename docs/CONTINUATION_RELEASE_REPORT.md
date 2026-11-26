# NimbusVault continuation release report

Date: 26 November 2026. This report covers the existing local integration and the expanded continuation acceptance. No GitHub push or hosting deployment was performed.

## Location and commands

Project: `C:\Users\hp\Downloads\nimbus vault final`. URL: **http://127.0.0.1:3100**. Branch: `codex/nimbusvault-integration`.

From this folder, with Docker Desktop running:

```powershell
# First setup / dependency repair only; existing configuration is preserved
npm run setup
# Ordinary start, optional explicit model warmup, and shutdown
npm start
npm run warmup
npm stop
# Consistent private backup
npm run backup
```

The direct Windows entry points are `scripts/setup.ps1`, `scripts/start.ps1`, `scripts/warmup.ps1`, `scripts/stop.ps1` and `scripts/backup.ps1`. `npm start` invokes PowerShell with the script path correctly quoted by the package runner. Services were restored after testing and left running. Startup performs no AWS deployment or consumer enabling. It checks both primary API and authenticated private-service readiness.

## Final implementation and architecture

Actual NimbusVault React/Vite design and repository organization remain the foundation. The same-origin Express API retains NimbusVault authentication, sessions, folders, file management, shares, permissions, activity and trash/restore. Isolated PostgreSQL16 on loopback55432 owns users, logical metadata and permissions. The token-authenticated FastAPI adapter on loopback8101 owns canonical local extraction, 384D normalized MiniLM embeddings, scoped FTS/BM25/hybrid retrieval, Qwen grounding, citations and actor-owned history in independent SQLite. Ollama on loopback11434 uses the existing Qwen2.5:3b Q4_K_M model. No paid AI provider is selected.

AWS retains genuine private S3 originals, DynamoDB cloud metadata, the existing native EventBridge/SQS/Lambda/Step Functions pipeline, IAM-protected API, CloudWatch, Standard SSM configuration and optional restricted S3 Vectors demonstration. Cloud stages terminate at the awaiting-local boundary; private local processing completes through outbound metadata reconciliation. No AWS component calls this laptop's localhost. See [architecture](ARCHITECTURE_FINAL.md) for diagrams and [AWS matrix](AWS_ACCEPTANCE_MATRIX.md) for service-by-service evidence and limits.

Implemented workflows include registration/login/refresh/logout/session checks, nested folders, 25 MiB authenticated multipart uploads, immutable keys and SHA256 verification, original download/preview, logical rename/move, sharing/inheritance/revocation, quota controls, trash/restore, real dashboard statistics, current filename/exact/semantic/hybrid search, folder/type/file scope, source passage viewing, real generated answers, comparisons, follow-ups, history, Stop, excerpt summaries, abstention and cited fallback. Administration does not grant private document access. Original CloudVault records remain preserved and unassigned.

## Important continuation improvements and repairs

1. Created recoverable checkpoint `8d07eda` before the expanded audit; preserved both donors and all pending work.
2. Fixed the interrupted filename-search test's TypeScript assertion shape. Current logical filenames now reach the private matcher; trusted scope is applied in SQL.
3. Reproduced the exact failed short query against unchanged canary bytes and the baseline implementation: zero hits before, one correct hit after. Full scoped lexical evidence no longer depends on a dense threshold in hybrid mode.
4. Repaired exact technical identifier retrieval and an RRF tie that favored the wrong date-policy document. Dense-only thresholds were not lowered.
5. Added server-authorized nested folder/type filtering, grouped search results, measured time/counts and mode explanations in the actual UI. Tests and browser use genuine controls.
6. Retained distinct verified claims sharing one quotation; normalized ordinary claim inflections without relaxing numbers/quotes; rejected changed security triggers and unsupported purpose elaboration.
7. Added bounded explicit-topic and short-excerpt coverage checks, model evidence focus and visible supported-partial warnings. At most one correction remains. Invalid output is never relabeled as generation.
8. Added a useful cited excerpt-summary action without claiming complete-document coverage. Existing long-document limits remain explicit.
9. Strengthened Cloud Infrastructure display with local model availability, observation timestamps and truthful unmatched-vector messaging.
10. Audited current AWS account/Free plan, queue/consumer bounds, native rule/target, IAM routes/roles, SSM configuration consistency, workflow histories, errors/duration and idle state. Downloaded only the 2,726-byte existing Lambda code package read-only, verified its package SHA256 and exact local-source match.
11. Made backend tests reproducible after LocalStack restart: a localhost-only runner recreates the disposable test bucket and checks the isolated test database. The initial NoSuchBucket failures are retained; assertions were not weakened.
12. Verified actual restart persistence, cold/warm Qwen and concurrent file-management responsiveness, plus dark/light landing themes, mobile navigation, scoped filters and summaries.

The transient build/restart overlap, incorrect audit CLI flag, mistaken deployed source filename and first insufficient lexical rescue were corrected and retested. These were verification/setup errors, not successful product checks. Intermediate model regressions remain in `verification-history`.

## AWS evidence and financial safeguards

The one previously approved native write rehearsal completed before this continuation. It used two tiny synthetic originals through NimbusVault, verified actual S3 bytes, native event/queue/function/workflow transitions, DynamoDB readback and local completion, and restored prior DISABLED/Disabled states. This continuation made bounded read-only AWS checks only. No new resources, role changes, paid-plan upgrade, object overwrite/deletion, queue purge or failure injection occurred.

Current detailed read audit: `2026-11-26T17:17:55Z`, approved default temporary profile, Sydney, **FREE / ACTIVE**, credits **USD139.998445**, reported expiry24May2027. The guard validates the existing account and reserve aboveUSD1, fails closed on unknown state and is not a hard billing cap. No personal-payment-method expenditure is authorized. Normal cached retrieval/generation makes no AWS calls.

The current rule is DISABLED, mapping Disabled, source queue empty and no running Step Functions execution was found. One historical DLQ test message is intentionally preserved. Existing failure/redrive evidence is explicitly from24November CloudVault: deployed rejection and a bounded local SQS redrive driver were separate tests. No fresh poison-message rehearsal was attempted.

The [full structured AWS matrix](AWS_ACCEPTANCE_MATRIX.json) supplies all requested columns for13 service/capability groups: resource alias, responsibility, source, method, expected/actual result, evidence/time, state, security, financial safeguards, limitations and status. Actual live reports distinguish NimbusVault operations, independent read-only checks, donor history, LocalStack and mocks. SSM values match active configuration; Lambda deployed bytes match source; IAM routes retain authentication; observed Errors Sum0 and Duration Average83.2075ms are historical-window datapoints, not fabricated current metrics. The optional cloud-vector query remains fixed to approved synthetic evidence and does not grant legacy corpus access.

## Search and AI measurements

[Search evaluation](SEMANTIC_SEARCH_BENCHMARK.md):60 queries over17 synthetic local documents, no cloud uploads. Final hybrid top-1/top-3 success100% on54 positive queries, Recall@3 99.07%, MRR1.0, correct negative abstention5/6, zero unauthorized leaks; median12.65ms and P95 18.27ms. Semantic-only top-1 96.30%, top-3 98.15%. The final ten fresh queries had8/8 positive top-1 hits and2/2 correct abstentions. These are small curated results, not perfect general accuracy. The initial50-query baseline and all paired cases are retained; initial held-out examples inspected during repairs are no longer claimed as untouched evaluation.

[Real Qwen evaluation](AI_QUALITY_EVALUATION.md):24 fixed questions,19 genuinely generated answer cases,5/5 correct insufficient responses,22/24 strict acceptance,96.49% expected-fact coverage, zero exact-quote/scope-check failures. Median1.747s. The two failing strict cases are incomplete excerpt summaries with visible partial warnings; they are not counted as full summaries. Representative displayed claims were reviewed against their actual synthetic supporting quotations. Automated citation validation is not a formal truth guarantee.

Actual final-application cold/warm pair:8.551s cold including6.163s model load,1.857s warm including0.012s model load. Retrieval67.03/18.40ms; concurrent file-management requests32/26ms. An initial primary MiniLM load took about11.9s in browser testing; warm local benchmark timings exclude that first load. Measurements are observations, not guarantees.

## Final automated, browser and security results

| Check | Actual result |
|---|---|
| Backend | 293 passed /12 suites /86.496s; isolated PostgreSQL and LocalStack |
| Frontend | 55 passed /13 files /12.94s |
| Python | 68 passed /26.55s; temporary databases, real MiniLM and real Qwen cases |
| Infrastructure | 22 passed; static tests, no deploy |
| Total | 438 automated tests; benchmarks/browser counted separately |
| TypeScript / production builds / ESLint / Python Ruff | Passed |
| Browser | 54 direct-route/viewport checks +7 real workflows, zero page errors |
| Final focused browser | 360/390/1366 layouts, real scoped search/type filter/time/counts, summary action, light/dark theme, mobile menu; passed |
| Authentication/security | Wrong password, logout invalidation, rotation/session suite, forged scopes/sources, nested share/revoke, during-generation revoke, early Stop and history ownership passed |
| Degraded modes | Actual AWS-disabled local search/generated answer and owned-Ollama-stopped cited fallback passed; services/config restored |
| npm production audit | Zero reported advisories at final check |
| Python dependency compatibility | All75 installed packages compatible |

The current Python advisory scan found zero known advisories among the auditable installed packages; the CPU-specific `torch==2.15.0+cpu` build was not found on PyPI and was explicitly skipped. It is not represented as fully audited. See `DEPENDENCY_SECURITY_AUDIT.json`; dependency compatibility and advisory matching are different checks.

The principal local-flow acceptance was rerun through the final primary API. It passed genuine two-document Qwen, follow-up, unsupported question, actual Stop499 with no completed canceled history, released generation slot, history revocation, owner statistics and authentication checks. Restart verification preserved the original rehearsal conversation and indexed original, not just a newly recreated fixture. See JSON evidence and the final dependency/source-safety reports for timestamps and precise scope.

No claim of penetration testing, production certification, complete account recovery, email verification or MFA is made. Normal browser controls do not expose active HTML/SVG or model tools; no model-generated command/cloud action is executed. Private runtime, backups, documents, credentials and model weights are excluded from Git.

## Preservation, screenshots and handover

Local donor comparison verifies all rows unchanged:12 files,61 chunks,21 conversations,32 exchanges, original config unchanged and donor tracked tree clean. Read-only cloud preservation verified12/12 originals present and61/61 original vector payloads equivalent. No owner was assigned. The final runtime also contains user-created private data; it is never treated as a disposable test database. Consistent private PostgreSQL/SQLite/config backups exist under `.private-backup` and must not be published.

Genuine screenshots are under `docs/screenshots` and private `.runtime/screenshots`. [Dashboard](screenshots/final-dashboard.png) shows only the isolated synthetic test account. The [operating handover](FINAL_HANDOVER.md), [security/migration guide](SECURITY_AND_PRESERVATION.md), [dry-run ownership plan](LEGACY_MIGRATION_DRY_RUN.md) and [evaluation/viva guide](EVALUATION_AND_VIVA.md) cover startup, backup, rollback, transfer, presentation and fallback procedures.

For the teacher: show landing/login/dashboard, nested fixture, original download/hash evidence, current cloud matrix/native history, paraphrased local search, multi-document answer and citations, then sharing/revocation and a no-evidence question. Use retained native evidence while consumers are idle. Another live upload-event demonstration requires fresh bounded approval; the existing journal must not be deleted to bypass its rerun guard. Current files/search/Ask are usable without continuously enabling the native workflow.

## Remaining limits and final checkpoint

- Two excerpt-summary cases omit details and are explicitly partial. No complete-document summary guarantee, OCR or formal entailment guarantee.
- One topical search false positive remains for an absent budget; the unauthorized document is excluded and Qwen abstains. One multi-document Recall@3 shortfall remains.
- Cloud-vector mode is a fixed safe synthetic demonstration, not unrestricted multi-user retrieval. Native consumers intentionally remain paused.
- Permanent cloud purge, new AWS failure rehearsal, hosted deployment, large-scale/adversarial testing and paid AI are not enabled.
- Low free RAM during concurrent evaluation can increase cold latency. Existing model caches are legitimate external dependencies; donor code/databases are not runtime imports.
- NimbusVault upstream LICENSE is empty; Qwen reports Research License. Redistribution permissions are not invented.

The final local Git checkpoint is recorded by `git log -1 --oneline` on `codex/nimbusvault-integration` and in the final handover reply. No push was performed. MERGE_PROGRESS and RESUME_CHECKPOINT retain the consumed cloud authorization, evidence, remaining limits and exact maintenance entry points.
