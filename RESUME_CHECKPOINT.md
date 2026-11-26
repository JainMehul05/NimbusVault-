# NimbusVault final checkpoint

Workspace: `C:\Users\hp\Downloads\nimbus vault final`; branch `codex/nimbusvault-integration`. Read README, MERGE_PROGRESS and `docs/FINAL_HANDOVER.md` before maintenance.

The local integration and final core verification are complete. Main URL http://127.0.0.1:3100. Commands: `npm start`, `npm run warmup`, `npm stop`, `npm run backup`; first-time repair: `npm run setup`. Docker Desktop is required. Final services were left running and warmed after degraded-mode verification. Stop only recorded owned processes, preserving volumes.

Latest actual suites:290 backend /55 frontend /60 Python /22 infrastructure passed. Browser54 responsive route checks +7 real workflows passed; focused final mobile/desktop dashboard and selected-document Ask checks passed. Real multi-document/follow-up/Stop/history-revocation and conflicting-policy generation passed. AWS-disabled local AI and Ollama-unavailable fallback passed. See sanitized reports in docs and private logs/screenshots in `.runtime`.

The one approved AWS write rehearsal is finished. `.runtime/aws-rehearsal.json` is the private authoritative journal; **do not delete it or rerun uploads**. EventBridge rule and SQS consumer restored DISABLED/Disabled. Read-only audits and final-app probes are documented. No paid plan/new resources/deployment/purge. Cloud writes need current active-Free-plan/account/reserve guard and any further rehearsal needs fresh approval.

Original CloudVault source/config/database unchanged:12 files,61 chunks,21 conversations,32 exchanges; all61 original vectors intact. Legacy owner unassigned. Private initial and final backups are under ignored `.private-backup`. Final runtime includes private user data as well as synthetic fixtures; never reset it or point inherited tests at it. Use separate `nimbusvault_test` and isolated LocalStack for destructive test suites.

Current laptop reuses existing MiniLM and Ollama model caches through private configuration; no code/database imports from donor. Read transfer guidance before removing donor caches. Local model accuracy, cold latency, licensing and disabled capabilities are documented honestly. No additional work should be inferred as authorization for cloud mutations.
