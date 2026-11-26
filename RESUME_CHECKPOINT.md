# NimbusVault resume checkpoint

Read MERGE_PROGRESS.md and the two original master attachments before further implementation.
Workspace: C:\Users\hp\Downloads\nimbus vault final. Branch codex/nimbusvault-integration.

Start: ./scripts/start.ps1
Stop: ./scripts/stop.ps1
Warm existing MiniLM and Qwen: ./scripts/warmup.ps1
URL: http://127.0.0.1:3100
Read-only AWS audit: ./scripts/verify-aws.ps1

Setup (existing .env preserved): ./scripts/setup.ps1
Dependencies: Node24, uv/Python3.13, Docker with isolated PostgreSQL16, existing local MiniLM cache and Ollama/Qwen cache, default temporary AWS authentication in Sydney. Local model locations are private runtime configuration, not source imports.

Owner approved ONE bounded rehearsal after Free-plan guard and no running donor workers; owner completed aws login. Rehearsal may currently be running: inspect .runtime/aws-rehearsal.json and .runtime/rehearsal-execution.log. Do not repeat if journal exists. Restore prior idle state on failure. Never provision, purge objects, assign legacy private content or run donor workers.

Current verification gaps: pending full browser/security/local-RAG checks and rehearsal completion evidence; do not declare release complete from build/tests alone.
Private source/config/consistent SQLite backups: .private-backup (ignored and owner restricted). Original CloudVault untouched. Active runtime PostgreSQL and SQLite contain only new synthetic accounts/documents; legacy12files/61chunks/history remain unassigned.
