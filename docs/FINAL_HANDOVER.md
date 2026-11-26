# Final handover

Location: `C:\Users\hp\Downloads\nimbus vault final`. Local branch: `codex/nimbusvault-integration`. No changes were pushed and no application was deployed to hosting.

## Daily operation

1. Start Docker Desktop. In this folder run `npm start`.
2. Run `npm run warmup` for an upcoming demonstration. Open http://127.0.0.1:3100.
3. Register/sign in with your own NimbusVault account. Existing donor documents have no assigned owner and do not appear automatically.
4. Upload a small supported text document, wait for Indexed, then use search or Ask. Opening a document's Ask action restricts retrieval to that file. A citation opens its exact authorized passage; Download original uses the authenticated file route.
5. Use `npm stop` when finished. Use `npm run backup` before maintenance.

Ports are loopback only: main application 3100, private intelligence 8101, PostgreSQL 55432, Ollama 11434. The database container is `nimbusvault-final-db`. Startup refuses occupied application ports and does not kill unrelated processes. The PID journal includes process start times. The main URL is printed only after both API and authenticated Python health checks pass.

## Configuration and recovery

`.env`, `backend/.env`, `intelligence/.env`, `.runtime`, `data`, database volumes and `.private-backup` are private, ignored runtime state. Do not attach them to an issue, commit them or copy them into a public archive. Model locations live in `.runtime/local-ai.json` and `EMBEDDING_CACHE_DIR`; the current setup reuses existing donor model caches read-only. Application code and databases are independent.

`npm run setup` is for dependency/build repair, not required on every start. It uses npm's lockfile, the Python lockfile with the CPU torch index, Prisma migrations and `compose.local.yml`. It preserves existing generated secrets. `scripts/setup-ai.ps1` reuses installed Qwen and checks Q4_K_M; if missing on another laptop it may download local runtime/model files, requiring disk and network. No paid API key is required. Review model licensing first.

For AWS authentication expiry, run `aws login --profile default` yourself and complete the browser sign-in. Do not share credentials/codes. The app uses Sydney and checks the account against the existing resource manifest. Cloud access remains blocked if the active Free plan or credit reserve cannot be verified. Cached local search/Ask are independent of cloud availability; downloading an original still requires AWS access.

`scripts/verify-aws.ps1` performs a bounded read-only audit. `scripts/cleanup-preview.ps1` has no apply/delete mode. Existing resources and original objects are protected. Neither script grants permission for writes. The approved rehearsal journal already exists; do not remove it to bypass the rerun guard. EventBridge and SQS consumers must remain in their previous idle configuration unless the owner approves another bounded rehearsal.

## Backups and rollback

`scripts/backup.ps1` creates a private timestamped PostgreSQL custom dump, validates its restore listing, creates a SQLite online backup with integrity validation and copies private local configuration. It does not back up model binaries or AWS login sessions. Treat the entire result as sensitive.

To restore, stop only final services, preserve the current state in a new backup, restore PostgreSQL into an isolated replacement database and validate it before switching DATABASE_URL. Restore the matching SQLite snapshot and configuration together; check original hashes and permissions before starting the UI. Do not restore final data over the original CloudVault database or reuse donor writable paths. Database restore is an operator procedure, not an automatic reset button.

Code rollback uses local Git checkpoints on `codex/nimbusvault-integration`. Database rollback requires matching backups; a Git checkout alone does not roll back data. The original CloudVault repository remains available independently. Never run both donor workers and final indexing against the same cloud stream.

## Transfer checklist

- Copy source and lockfiles, preserving notices. Review the empty NimbusVault upstream LICENSE and Qwen Research License before redistribution.
- Install Node, uv/Python and Docker; run setup with independently selected model cache paths. Do not copy `node_modules` or the virtual environment.
- Transfer private backups/config only by a secure channel with explicit owner authorization. Generate new secrets for an independent installation.
- Restore into an isolated database. Verify data integrity, scopes, loopback ports, login and logout before cloud operations.
- Authenticate AWS as the authorized account; reuse existing resources only. Verify the current Free plan and reserve. An expired Free plan means cloud access stays disabled.
- Warm existing models, test a non-sensitive local fixture, check citations and unavailable-model fallback. Do not automatically replay cloud rehearsals.

Troubleshooting: inspect local `.runtime/*-error.log` without publishing secrets or user content. A slow first answer may be model load; warmup is explicit. If a query is unsupported or model claims fail validation, use the clearly labeled fallback and inspect citations. More detail is in [verification](VERIFICATION_FINAL.md).
