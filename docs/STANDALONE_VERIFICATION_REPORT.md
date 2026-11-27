# Final standalone independence audit â€” 27 November 2026

## Decision and deployment baseline

`nimbus vault final` is the only required **application source directory**. Neither `cloudvault-backup` nor the recreated `cloudvault` cache directory is required to operate this verified Windows installation. Keep the complete final project, including its ignored private configuration, data and `.runtime/standalone-ai`, plus its PostgreSQL Docker volume and the existing AWS resources. A Git checkout alone does not contain secrets, databases or model weights.

The original CloudVault source folder can be removed from the operational path once the separately validated recovery backup below is retained. This audit did not delete it. Retain that recovery backup: it is the preserved home of the original private corpus and conversations, which were deliberately not reassigned to current application users. This is not a recommendation to erase all legacy data copies.

Git baseline tag: `nimbusvault-standalone-baseline-20261127`. This checkpoint is the corrected source baseline for the upcoming AWS deployment. **Linux EC2 deployment itself is not yet verified.** Follow `LINUX_STANDALONE_BASELINE.md`; recreate native dependencies and run acceptance on EC2 before treating it as a production release.

## MiniLM cache and fresh embeddings

Found and repaired `EMBEDDING_CACHE_DIR` pointing to the old `Downloads/cloudvault/CloudVault/data/models`. Copied the complete cache into `.runtime/standalone-ai/embedding-cache`, materializing files. Root, backend and intelligence environment files now use this project-relative cache. Python resolves it against the project root rather than the current working directory and rejects resolved cache paths outside the project.

Fresh synthetic documents were extracted, chunked and embedded with real MiniLM in isolated databases with Hugging Face offline mode enabled. These tests do not rely on pre-existing document vectors. The secondary TypeScript embedding provider has a project-relative `.cache/models` default and is disabled in the canonical intelligence configuration; no donor cache is used by that path.

## Ollama runtime, Qwen and hash integrity

`local-ai.json` now uses project-relative paths for the copied runtime and model store. SHA256 comparisons matched **75/75 runtime files, 9/9 Qwen files and 19/19 MiniLM files** against the donor. All six blobs referenced by the Qwen manifest matched their declared content digest and byte size. The approved `qwen2.5:3b` Q4_K_M model was reused without downloading it.

Model-side `metadata/sha256-*.json` files are metadata about a digest, not content-addressed model blobs; blob self-hash verification correctly applies only to `blobs/`. Full private file hashes are in `.runtime/standalone-integrity.json`; the source-safe summary is `STANDALONE_INTEGRITY_SUMMARY.json`.

## Environment variables and external references

Checked active root/backend/intelligence environment files, AI configuration, relevant process environment and Windows user/machine environment for donor paths. No active donor-directory references remain. Standard installed Node, uv/Python, Docker and AWS login/profile files remain system prerequisites, rather than project source dependencies. AWS credentials were not copied into source.

Retained historical logs, donor documentation, preservation tools and old private configuration snapshots may mention CloudVault. `cloudvault/` S3 prefixes, existing stack names and the SQLite filename are compatibility identifiers for existing data, not local filesystem dependencies. They were preserved rather than renamed destructively. Donor-comparison scripts explicitly require a source argument and are audit tools, not startup dependencies.

## Setup scripts

Setup no longer discovers Ollama through global `PATH` or adopts `OLLAMA_MODELS` from an external installation. It uses the project-local runtime/store, rejects external runtime/model/cache arguments, and rewrites the embedding cache to its portable location. Launchers reject AI symlinks/junctions and a port-11434 listener belonging to an external executable. Tests confirmed external donor cache arguments are rejected and project-local configuration is accepted.

The complete `npm run setup` execution passed, reusing local AI assets, applying no pending migrations and building both applications. Its output is recorded in `.runtime/standalone-full-setup.log`. The installer emits dependency deprecation and npm install-script policy notices; these are not evidence that production security or Linux deployment has been certified. No dependency upgrades were requested or applied as part of this audit.

## Docker mounts and symbolic links

The canonical local PostgreSQL service uses the named volume `nimbusvaultfinal_nimbusvault-final-postgres` mounted at `/var/lib/postgresql/data`; it has no donor-directory bind mount. Both Compose files were inspected. The legacy LocalStack Compose stack is separate from the canonical intelligence/Qwen installation and is not a complete EC2 deployment manifest.

No Git-tracked symlinks and no reparse points in active AI/data trees were found. `.dockerignore` now excludes `.runtime`, `.private-backup`, application data, the Python venv and bytecode, preventing private backups and Windows AI binaries from entering the Docker build context.

## Regression tests

| Check | Result |
|---|---|
| Backend integration/unit suites | 296 passed, 12 suites |
| Frontend | 57 passed, 13 files |
| Infrastructure | 22 passed |
| Python intelligence | 74 passed with real MiniLM/Qwen available |
| Production backend/frontend build | Passed |
| Backend/frontend lint and backend typecheck | Passed |
| Source secret/ignore audit | Passed |
| Responsive UI and citations | Passed; no page errors |

The first backend run had one PDF/DOCX test exceed its five-second timeout during concurrent heavy work; the full repeat passed without weakening assertions. A later Python repetition while Ollama was stopped returned extractive fallback in two generation tests; it was repeated with the required runtime available. Original failed logs were retained rather than hidden.

## Search and AI benchmarks

`SEARCH_BENCHMARK_STANDALONE.json` records real offline MiniLM retrieval, including fresh held-out and independent questions, permission checks and negative cases. Across 84 queries per mode, the hybrid result had top-1 accuracy 1.0, recall@3 approximately 0.9855, all 15 negative cases correctly abstaining and no unauthorized leaks. Hybrid median retrieval latency was approximately 20.4 ms (p95 36.9 ms) for this benchmark run; these are local synthetic-corpus timings, not EC2 guarantees. All 13 explicit search-mode/reindex cases passed.

`STANDALONE_AI_BENCHMARK.json` passed **24/24** cases: 19 genuinely generated answers, five correct insufficient-evidence cases, expected fact coverage 1.0, zero quotation failures and zero permission failures. Median end-to-end latency was approximately 1.96 seconds in that run.

The repeated application runtime benchmark also passed three cold/warm pairs with persisted account, indexed fixture and original conversation verified. Cold-model median was 5.455 seconds; warm median was 1.568 seconds. The first request after the full service/dependency restart took **84.406 seconds**, including 75.627 seconds reported in retrieval initialization. Subsequent retrieval took approximately 10–16 ms and file-management calls remained responsive at 15–33 ms. This cold initialization cost is retained in `INDEPENDENT_RUNTIME_PERFORMANCE.json`; it must not be represented as a warm 20 ms response. The existing `npm run warmup` command can prepare the local models before interactive use; its benefit is not a substitute for reporting the cold result.

## Genuine application Qwen, multi-document RAG and citations

The running backend `/ai/ask` flow returned `mode=generated` and citations from both documents in a two-document answer. Follow-up questions, insufficient-evidence abstention, cancellation without completed history, generation-slot release and historical-answer access after sharing revocation all passed. These application checks are separate from direct model API availability.

Browser checks verified source/citation controls, BM25/exact badges, nested folder scope, filters, document summaries, mobile navigation and light/dark themes at 360, 390 and 1366 pixel widths. Evidence is in `LOCAL_RAG_ACCEPTANCE.json` and `FINAL_UI_ACCEPTANCE.json`.

## AWS integration and account restrictions

Read-only verification checked 12 services in the existing Sydney account. The account remained **FREE / ACTIVE** with its existing credit reserve. After an overnight session expiry, the owner refreshed AWS login and the audit was repeated successfully. No AWS resource mutations, account upgrades, cloud deployment, consumer activation, uploads or deletion were performed by this audit.

Application probes verified the existing approved S3 Vectors fixture, SigV4-protected API access, unsigned HTTP 403, three Standard Parameter Store parameters and native logs. `AWS_CURRENT_STATUS.json`, `AWS_VECTOR_DEMO.json` and `APP_CLOUD_PROBE.json` retain the evidence. This is current read/integration verification; cloud write workflows were covered by isolated regression tests rather than unauthorized live AWS mutations.

## Authentication and access boundaries

Real local accounts verified wrong-password rejection, logout immediately revoking access, sharing/revocation and private dashboard scope. Unauthenticated backend/private-intelligence access and other-user document access returned their expected 401/403/404 boundaries. No legacy private data was reassigned or exposed to enable testing.

## Data preservation and separate original recovery backup

The independent sibling backup is `C:/Users/hp/Downloads/cloudvault-recovery-20261127-005510`. Its 873 files include original source, Git history and private configuration. Original non-database file hashes match. All rows match in five consistent SQLite database snapshots; each passed `PRAGMA integrity_check`. The original active database retains **12 files, 61 chunks, 21 conversations and 32 exchanges**. `PRESERVATION_LOCAL_AUDIT.json` also confirms the original tracked Git tree is clean and its initial preserved data remains unchanged.

Reinstallable `node_modules`, Python venvs, bytecode/cache trees and AI runtime/model directories were excluded from the sibling recovery copy. The validated AI assets are independently present in this final project; recovery of the original source can reinstall those reproducible dependencies. Existing private S3 object bytes remain in AWS and are not represented as a local object archive. The sibling backup has owner-only directory permissions. `RECOVERY_HASH_MANIFEST.json` is stored inside it; private file contents are not committed to Git.

Current NimbusVault PostgreSQL and SQLite were backed up separately under `.private-backup`. A PostgreSQL custom dump was restored into an isolated audit database, without overwriting the live database. An early pre-test dump naturally had fewer authentication/activity records than the post-test live database. A fresh post-test dump was then restored and all 12 PostgreSQL tables matched the live database exactly; the consistent SQLite backup also matched all tables. See `STANDALONE_POSTGRES_RESTORE.json` for the final restore comparison. Audit restore databases were retained rather than deleted.

## Shutdown and restart

Owned-process shutdown/start was repeated using the project launchers with the original directory unused. The database volume and SQLite data were preserved. The Windows stop implementation terminates owned processes; these checks demonstrate idle data-preserving restart, not graceful draining of an arbitrary in-flight request. Linux production should use systemd and the backend's signal handling and repeat shutdown acceptance there.

## Linux EC2 requirements

The upcoming deployment must install native Linux Ollama, recreate the Linux Python environment and Node dependencies, and transfer platform-independent Qwen/MiniLM assets and consistent private data backups. Windows `.exe`, DLLs, venvs and `node_modules` are not deployment artifacts. The npm platform wrapper explicitly blocks unsupported Linux orchestration rather than accidentally executing a Windows launcher.

No CloudVault folder is required for that deployment. Native service provisioning, TLS, production secrets/IAM, restore, migrations and actual Linux end-to-end acceptance remain the next deployment task. This report does not claim that an EC2 instance has been provisioned or that those deployment checks have already passed.
