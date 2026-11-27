## Session B complete — 27 Nov 2026 ~12:45 UTC (supersedes everything below)
Public URL https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com (API Gateway + VPC link + Cloud Map → EC2 private IP:8080). CloudFront blocked pending AWS Support account verification (VPC origin already Deployed). EC2 STOPPED 12:39 UTC; rule DISABLED, mapping Disabled; temporary S3 objects deleted. Startup failure (curl 56) fixed; 3 ordinary start cycles, watchdog and Scheduler stops verified live. Reports: `docs/AWS_FINAL_DEPLOYMENT_REPORT.md` (Session B section), `docs/PUBLIC_DEPLOYMENT_GUIDE.md`. A separate tool (likely Codex) added `.bat` launchers in parallel; its 11:38 UTC launcher-stop interrupted tests — never run both against EC2 at once. Next: CloudFront after verification (approval needed); optional cleanup.

---

## Session B planning — 27 Nov 2026 ~11:15 UTC (no AWS changes)

User's later `aws:start` (10:46:43 UTC) failed: readiness curl exit 56 (connection reset from Docker port proxy 21 s after boot; curl does not retry 56) → script stopped the instance as designed. User now requires an AWS-generated public HTTPS URL (CloudFront `*.cloudfront.net`), no third-party DNS. Proposal: `docs/PUBLIC_DEPLOYMENT_PROPOSAL.md` (VPC origin first, API Gateway VPC-link fallback, async AI, public abuse limits, robust readiness, tag-based session deadlines). Fresh Trivy rescan: same 23 IDs (`.runtime/public-deployment/`). **Awaiting explicit approval + visitor-access policy choice. EC2 stopped.**

---

## Claude — AWS Session A complete — 27 November 2026 (supersedes everything below)

Read `docs/AWS_FINAL_DEPLOYMENT_REPORT.md`. Session A (`session-a-1acdcb4a`) deployed and accepted on EC2 `i-0569d222e63fc7f36` (m7i-flex.large, 30 GiB encrypted gp3, Sydney); **instance STOPPED and verified 10:34 UTC**; rule DISABLED, mapping Disabled, queue 0, DLQ 1; temporary S3 bundle objects deleted. Session A approval expired 13:25:30 UTC — **any further AWS work needs new user approval**. Resources: `.runtime/aws-deployment/resource-ledger.json`. Results: 64/64 app, 54/54 browser, search 84 at baseline, Qwen 40/40, native workflow SUCCEEDED, stop/start + backup verified; laptop regression 298/59/83/22. Next actions (all need approval): optional S3 original export; optional future demo session; optional cleanup of instance/volume/roles/SG/schedules. No GitHub push.

---

## Claude continuation — 27 November 2026 (supersedes the Codex block below)

Read `CLAUDE.md` and `docs/CLAUDE_HANDOVER_STATE.md`. Local preparation is complete: the corrected 40-case Qwen replay passed 40/40 (31 generated, 9 abstentions), the 84-query search held its baseline, there are 460 Linux regression tests, the bundle was rebuilt and hash-verified, the host AWS CLI installer was fixed, and the security CVE table is complete. **No AWS resources exist or were modified.** Phase: awaiting explicit user approval of `docs/AWS_DEPLOYMENT_APPROVAL_PROPOSAL.md` (Session A, 4 h max, USD 10 cap, 20 GiB encrypted gp3). Next action: on approval, record `.runtime/aws-deployment/authorization.json` and `resource-ledger.json`, recheck the guard, upload the bundle, then provision.

---

## Current AWS deployment preparation — 27 November 2026

Branch: `codex/aws-deployment-preparation`, based on standalone commit `2c9083696f2fe79e2cf5528f9d39cbdefbb36905` and its existing tag. The complete 2,608-line deployment request is preserved privately at `.runtime/aws-deployment/master-request.txt`. The verified Windows fallback, private databases, original recovery directories and existing AWS resources are preserved.

**No new cloud mutations are authorized or performed. No instance exists yet.** Suggested one-instance/four-hour/USD10 limits are a proposal, not permission. Complete safe local preparation and read-only discovery before asking for the single consolidated authorization.

Current read-only observations: FREE/ACTIVE, USD139.997874 credits; `m7i-flex.large` eligible and available in Sydney, 2 vCPU/8 GiB; Canonical Ubuntu 24.04 x86-64 AMI discovered; no existing regional EC2 instances. Authoritative private evidence: `.runtime/aws-deployment/discovery.json`. Actual rates: compute USD0.1197/hour, public IPv4 USD0.005/hour, gp3 USD0.096/GiB-month. Prior report discrepancy: 12 service checks included two SQS timeouts, not 12 successful results.

Preparation in progress: separate Linux Dockerfiles/Compose; default Windows loopback/profile preserved; explicit private container service URLs; standard instance-role credential chain; expiry/currency/reserve-aware fail-closed guard (20 targeted tests passed); scoped IAM and boot-bound systemd stop safeguard being prepared. Linux images are building locally; no EC2 result may be inferred from these tests. Current status and next action are in `.runtime/aws-deployment/state.json`.

Next: finish container builds, test CPU models and isolated data/auth/shutdown, complete exact resource/IAM/price/security proposal, package sanitized source, create preparation Git checkpoint, then request approval. Never replay the old rehearsal journal or copy personal AWS credentials/private data into EC2.

---

# NimbusVault final independent checkpoint

Independent audit completed. Read `docs/INDEPENDENT_AUDIT_REPORT.md` first; it supersedes historical figures below. Current449 automated tests (296 backend/57 frontend/74 Python/22 infrastructure), real browser54+7, focused UI/access checks,84 search queries, original24/24 plus new16/16 strict Qwen cases. Active cancellation observed and passed499/no completed history/next slot; cloud-paused and model-stopped checks restored. Final app running/warmed at http://127.0.0.1:3100. `git log -1` gives final checkpoint; no push.

The single approved cloud write rehearsal remains consumed. Current independent cloud work was read-only. Keep EventBridge and SQS consumer disabled. Never reset runtime data:it includes a private user PDF. Preserve all12 donor originals/61 vectors and unassigned legacy ownership. Source/configuration preservation passed. Private final backup under `.private-backup`; do not expose it. Use `npm start`, `npm run warmup`, `npm stop`, `npm run backup`. Any fresh cloud mutation/rehearsal needs fresh owner approval and current guard.

## Historical checkpoint

# NimbusVault final checkpoint

Expanded continuation completed: read `docs/CONTINUATION_RELEASE_REPORT.md`, `docs/SEMANTIC_SEARCH_BENCHMARK.md`, `docs/AI_QUALITY_EVALUATION.md` and `docs/AWS_ACCEPTANCE_MATRIX.md`. Latest test totals supersede the historical figures below:293 backend +55 frontend +68 Python +22 infrastructure =438. Real browser54+7 passed again. Search60 queries; hybrid54/54 positive top-1,5/6 correct negatives; two original held-out defects were repaired and ten fresh queries retained as untuned evaluation. Actual Qwen22/24 strict,19/19 real positive generations,5/5 abstentions; two summary coverage shortfalls visibly partial. Current detailed AWS audit read-only and idle verified; no new mutation authorization. Source checkpoint baseline8d07eda exists; source/preservation audits passed; git log -1 identifies the final checkpoint. Services restored/running/warmed; only own LocalStack test container stopped. Do not replay cloud writes or reset final private data.

Workspace: `C:\Users\hp\Downloads\nimbus vault final`; branch `codex/nimbusvault-integration`. Read README, MERGE_PROGRESS and `docs/FINAL_HANDOVER.md` before maintenance.

The local integration and final core verification are complete. Main URL http://127.0.0.1:3100. Commands: `npm start`, `npm run warmup`, `npm stop`, `npm run backup`; first-time repair: `npm run setup`. Docker Desktop is required. Final services were left running and warmed after degraded-mode verification. Stop only recorded owned processes, preserving volumes.

Latest actual suites:293 backend /55 frontend /68 Python /22 infrastructure passed. Browser54 responsive route checks +7 real workflows passed; focused final mobile/desktop dashboard and selected-document Ask checks passed. Real multi-document/follow-up/Stop/history-revocation and conflicting-policy generation passed. AWS-disabled local AI and Ollama-unavailable fallback passed. See sanitized reports in docs and private logs/screenshots in `.runtime`.

The one approved AWS write rehearsal is finished. `.runtime/aws-rehearsal.json` is the private authoritative journal; **do not delete it or rerun uploads**. EventBridge rule and SQS consumer restored DISABLED/Disabled. Read-only audits and final-app probes are documented. No paid plan/new resources/deployment/purge. Cloud writes need current active-Free-plan/account/reserve guard and any further rehearsal needs fresh approval.

Original CloudVault source/config/database unchanged:12 files,61 chunks,21 conversations,32 exchanges; all61 original vectors intact. Legacy owner unassigned. Private initial and final backups are under ignored `.private-backup`. Final runtime includes private user data as well as synthetic fixtures; never reset it or point inherited tests at it. Use separate `nimbusvault_test` and isolated LocalStack for destructive test suites.

Current laptop reuses existing MiniLM and Ollama model caches through private configuration; no code/database imports from donor. Read transfer guidance before removing donor caches. Local model accuracy, cold latency, licensing and disabled capabilities are documented honestly. No additional work should be inferred as authorization for cloud mutations.
