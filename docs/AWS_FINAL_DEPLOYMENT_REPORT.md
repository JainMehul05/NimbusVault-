# Session B — public AWS website and startup repair (27 Nov 2026)

**Status: public website working; EC2 now STOPPED (verified 12:39 UTC).** Public URL (AWS-generated, AWS certificate): **https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com** — the same URL after every authorized stop/start. Start `npm run aws:start -- --hours 2` · warm `npm run aws:warmup` · stop `npm run aws:stop`. Visitors need no AWS credentials. Guide: `PUBLIC_DEPLOYMENT_GUIDE.md`.

| Item | Result | Class |
|---|---|---|
| Startup failure root cause | Readiness curl ran 21 s after boot; Docker's port proxy reset the connection (curl exit 56), which `--retry-connrefused` never retries. Reproduced live: probes `56 56 0`; old command exit 56; new `ec2-ready.sh` READY after 3 s | Live EC2 |
| Startup repair | Staged bounded readiness (service, DB, backend JSON, intelligence, Ollama, origin guard, public HTTPS), consistent timeouts, labelled diagnostics before safe stop, session workflow (`--hours`, YES, deadline tag, fresh schedule) | Code + live |
| Ordinary start cycles | 3 ordinary cycles + 1 bootstrap: ready in 40 / 45 / 46 s (end-to-end 52–60 s); users, files, conversations, index and models persisted | Live EC2 |
| CloudFront | VPC origin **Deployed**; distribution **refused** by AWS ("account must be verified … contact AWS Support") — pending verification | Live AWS |
| Public endpoint | API Gateway HTTP API → VPC link → Cloud Map → EC2 private IP:8080 (no public inbound); secret origin header; true client IP header; 20 rps / 40 burst | Live AWS |
| Public application checks | All passed (invite registration, demo accounts, auth/CSRF/CORS/rotation, folders, isolation, all search modes, Qwen single/multi/follow-up/abstain, grounded citations, SHA-256 downloads, sharing/revocation, prompt injection, trash/restore, async concurrency, security probes) | Public HTTPS |
| Native AWS workflow from the public site | S3 → EventBridge → SQS → Lambda → Step Functions SUCCEEDED → DynamoDB → EC2 reconciliation → searchable → semantic rank 1 → cited Qwen answer → SHA-256 match; window 0.81 min; idle restored | Live AWS |
| Browser (public URL) | 54/54 responsive + 7 workflows, 0 console errors, 0 failed requests, 0 mixed content | Public HTTPS |
| External network | Your iPhone on mobile data (152.59.x.x): site, assets, invite registration 201, authenticated file APIs 200 | Public HTTPS (server-log evidence) |
| Search 84 (final runtime) | Hybrid 69/69, 15/15 negatives, Recall@3 98.55 %, MRR 1.0, 0 leaks | Live EC2 |
| Safeguards | Watchdog: expired authorization → instance-initiated shutdown in 34 s (journal "Authorization expired"). External Scheduler: StopInstances by the safety role (CloudTrail) 24 s after schedule; schedule auto-deleted | Live AWS |
| Regression (laptop) | Backend 309 (11 new), frontend 60, Python 83 + 2 real-Qwen (Windows GPU), infra 22, launcher 10 | Windows local |
| Qwen 40-case | Not rerun: intelligence/Ollama unchanged since Session A's 40/40; the new async request path is covered by the public checks | Historical |

Defects fixed in Session B: startup readiness (curl 56); manual-JSON session authorization → `--hours`/YES workflow; boot-only deadline → tag-based watchdog; API Gateway reserves `X-Forwarded-For` → secret-gated client-IP header; long AI requests vs gateway timeouts → async jobs; open registration with 5 GiB quota → invite codes, quotas and caps; one-click launcher accepted only CloudFront → also accepts the AWS API Gateway URL.
Credits still read USD 139.997804 (billing lag); Session B ≈ 72 instance-minutes ≈ USD 0.15 plus API Gateway/Cloud Map cents. ₹0 out-of-pocket.

---

# NimbusVault — AWS Session A final deployment report

27 November 2026 · Claude Opus 5.5 (continuing Codex) · Approved Session A (`session-a-1acdcb4a`).
Private evidence: `.runtime/aws-deployment/` (not published; contains synthetic credentials and account IDs).

## 1. Status
**Deployed and accepted on AWS EC2; instance now STOPPED.** The complete application ran on EC2 independent of the laptop. Native AWS workflow, search, genuine Qwen RAG, security, shutdown, stop/start and backup were verified. Remaining limitations are listed in §12.

| Item | Value |
|---|---|
| Instance | `i-0569d222e63fc7f36`, **m7i-flex.large** (2 vCPU, 7.6 GiB usable), on-demand |
| Region / AZ | ap-southeast-2 (Sydney) / ap-southeast-2a |
| OS | Ubuntu 24.04.5 LTS, AMI `ami-048c1a9eb63a67eed` (Canonical, no product code), kernel 7.0.0-1018-aws, x86_64 |
| Storage | `vol-0c3b9f3604b9d7a67`, 30 GiB gp3, **encrypted**, 3000 IOPS/125 MB/s; 9.2 GiB used after cleanup |
| Current state | **stopped** (verified 10:34 UTC); public IPv4 released; no Elastic IP |
| Runtime used | ≈ 58 min of the approved 4 h (09:35:30–≈10:24 UTC, plus restart test ≈10:25–10:34 UTC) |
| Access | Private SSM port forwarding → `http://127.0.0.1:3200` (**not a public website**; needs AWS login) |

## 2. Commands (Windows PowerShell, project root)
| Purpose | Command |
|---|---|
| Start approved instance | `npm run aws:start` — checks identity, FREE/ACTIVE, credits > USD 10, approval window and the external stop schedule; never creates resources |
| Open the site | `npm run aws:connect` → browse `http://127.0.0.1:3200` |
| Warm MiniLM + Qwen | `npm run aws:warmup` (≈20 s) |
| Status | `npm run aws:status` |
| Backup on host | `npm run aws:backup` |
| Stop and verify | `npm run aws:stop` |
| Windows app (unchanged) | `npm start` / `npm stop` → `http://127.0.0.1:3100` |

`aws:start` refuses after this session's approval expires (13:25:30 UTC today) — a new session needs your approval, a new `authorization.json`, an updated `NimbusStopDeadline` instance tag and a new external stop schedule.

## 3. Architecture (as deployed)
```
Laptop browser ──SSM port forward (IAM-authenticated)──► EC2 127.0.0.1:3100
EC2 (Ubuntu 24.04, Docker Compose, no inbound ports, HTTPS egress only)
 ├─ api (Express + React build)      networks: application(internal), access   ── no AWS credentials, IMDS + egress blocked
 ├─ intelligence (FastAPI, MiniLM)   networks: application, models, aws-egress ── only container allowed to reach IMDS/AWS (instance role)
 ├─ ollama (Qwen2.5 3B Q4_K_M, CPU)  network: models(internal)                  ── no internet
 └─ postgres (pgvector 16)           network: application(internal)             ── no host port
 systemd: nimbusvault.service · nimbus-runtime-limit.timer · nimbus-deadline (tag) · nimbus-credit-watchdog.timer (2 min)
AWS (existing, reused): S3 cloudvault/files/ ─► EventBridge rule ─► SQS ─► Lambda ─► Step Functions ─► DynamoDB
                         + S3 Vectors · API Gateway (IAM) · Parameter Store · CloudWatch · CloudFormation
Independent safeguards: EventBridge Scheduler (stop instance; restore rule/consumer to idle)
```

## 4. Results summary
| Area | Result | Evidence class |
|---|---|---|
| Application acceptance via EC2 | **64/64** checks | Actual EC2 application + actual AWS |
| Browser | **54/54** responsive + 7 workflow checks, 0 page errors | Actual EC2 via SSM, real browser |
| Search (84 queries, unchanged judgments) | Hybrid top-1 69/69, top-3 69/69, Recall@3 98.55 %, MRR 1.0, negatives 15/15, 0 leaks; dense 65/69; BM25 64/69 (neg 8/15) | Actual EC2 runtime, 0 AWS calls |
| Qwen (40 strict cases) | **40/40**; 31/31 genuinely generated; 9/9 abstentions; 0 quotation/permission failures; 0 extractive fallbacks | Actual EC2 CPU Qwen |
| Native AWS workflow | S3 → EventBridge → SQS → Lambda → Step Functions SUCCEEDED → DynamoDB → EC2 reconciliation → searchable | Actual AWS, new |
| Graceful shutdown | API stop 10.7 s during active generation, HTTP 499, exit 0, no partial history | Actual EC2 |
| EC2 stop/start | Stop 31 s; start→healthy 40 s; data, conversations, index, models, deadline preserved | Actual EC2 |
| Backup | 12/12 PostgreSQL tables match after isolated restore; SQLite integrity ok | Actual EC2 |
| Regression (laptop, after Claude's changes) | Backend 298, frontend 59, Python 83 (+2 real-Qwen deselected), infra 22 = **462** | Windows local |

## 5. Performance (EC2, CPU only)
Boot 31 s · start→app healthy 40 s · first semantic search after boot 11.5 s (MiniLM load) · warm search 0.5 s via tunnel (6.8 ms median server-side hybrid) · first answer after boot 70.7 s (Qwen load from EBS) · warm answer 31 s · `aws:warmup` 20 s · generation **≈4.1 tokens/s**, prompt 59–176 tokens/s · 40-case median 28.1 s, generated p90 63.6 s, max 75.9 s · excerpt summary 109 s · file listing during inference ≈450 ms (tunnel RTT) · RAM: Ollama 2.4 GiB, intelligence 0.6 GiB, ≈4.2 GiB free, 0 OOM · disk 9.2/29 GiB. The laptop RTX 4050 is ≈1.5 s warm; EC2 CPU is ~20× slower — usable for demonstration, not equivalent. See `EC2_PERFORMANCE_REPORT.md`.

## 6. Financial
| | Value |
|---|---|
| Plan | FREE / ACTIVE, expires 2027-05-24 — never upgraded |
| Credits before / last read | USD 139.997804 / 139.997804 (billing lags by hours; consumption not yet posted) |
| Estimated credit use, Session A | ≈ USD 0.13 (compute ≈0.97 h × 0.1197, IPv4 ≈ 0.005, prorated EBS, negligible S3/Lambda/SFN/Scheduler) |
| Continuing while stopped | 30 GiB gp3 ≈ **USD 2.88/month** (credits), until you delete the volume |
| Out-of-pocket | **₹0**. No paid plan, Marketplace, Bedrock, RDS, NAT, LB or EIP |
Three safeguards were live: boot/absolute on-host poweroff (13:20:30 UTC), external Scheduler stop (13:25:30 UTC) and a 2-minute credit watchdog using the instance role (verified succeeding).

## 7. Defects found and fixed
| # | Defect | Fix | Regression |
|---|---|---|---|
| 1 | Bundle held a stale Ollama image and scripts | Rebuilt; 345 files re-hashed, 0 mismatches | Host SHA-256 check passed |
| 2 | Ubuntu 24.04 has no `awscli` → host install/watchdog would fail | Official AWS CLI v2 with PGP `VALIDSIG` check | Installed v2.42.4 on EC2 |
| 3 | Watchdog unit could fail on read-only HOME → false poweroff | Private HOME/PrivateTmp | Watchdog ran successfully every 2 min |
| 4 | `/cloud/probe` and `/cloud/vector-demo` wrote to read-only `/app/.runtime` in the container | `evidence_path()` on the data volume in container mode | New Python test; both endpoints passed live |
| 5 | Cloud page and landing page claimed processing runs "on this laptop" on EC2 | Health reports `host`; UI labels EC2 truthfully; Windows wording unchanged | 2 new frontend tests; browser check |
| 6 | Model-unavailable hint named a Windows script inside the container | Deployment-aware hint | New Python test |
| 7 | Scheduler universal target needs `Uuid`, not `UUID` | Corrected (safeguard drafts too) | Restore schedules fired, 0 target errors |
| 8 | Stop/start could extend a boot-relative timer | Absolute deadline from instance tag + boot cap | Deadline unchanged after restart |
Test-script corrections (not app defects): CSRF header, conversation scope on follow-ups, citation schema, restore polling.

## 8. Security
No inbound SG rules; sshd disabled; IMDSv2 required (v1 → 401); only the intelligence container can reach IMDS/AWS; api/ollama cannot reach IMDS or the internet; Postgres/FastAPI/Ollama not on host ports; invalid service token → 401; non-admin infrastructure → 403; CSRF/CORS/refresh rotation/replay/logout verified; cross-user files, folders, downloads, search, conversations denied; revoked share removed from search and RAG; prompt injection did not leak secrets or run commands. Residual unfixed upstream CVEs (1 scanner-critical libxml2 in Postgres, 22 HIGH identifiers, OpenSSL most relevant) — `AWS_DEPLOYMENT_SECURITY.md`. Accepted only for this private synthetic deployment.

## 9. AWS changes (ledger: `.runtime/aws-deployment/resource-ledger.json`)
Created: EC2 instance, EBS volume, SG `sg-0fce31aed9cee47dc`, roles/instance profile `nimbusvault-ec2-demo-20261127`, role `nimbusvault-ec2-safety-20261127`, 3 one-time schedules. Wrote: 3 synthetic originals (canary 242 B, note 339 B, memo 327 B), 1 derived canary artifact, DynamoDB job/file records, 1 Step Functions execution, 1 S3 Vectors query. Temporarily enabled then restored: rule and mapping (0.8 min). Temporary bundle objects: uploaded and **deleted**. Untouched: 16 pre-existing originals (3.11 MB), DLQ message, vectors, stack, parameters.

## 10. Data preservation
Windows app, private databases, `cloudvault-recovery-*` and other directories untouched; Windows backend/frontend/Python/infra tests pass. Correction: 16 pre-existing objects (3,110,073 bytes) were present under `cloudvault/files/`, not "12 / 1.79 MB" as earlier docs stated.

## 11. Final idle state (verified 10:34 UTC)
EC2 stopped · rule DISABLED · mapping Disabled · 0 running executions · ingestion queue 0 · DLQ 1 (unchanged) · cloud mode on EC2: reads on, **writes off**.

## 12. Remaining limitations / not verified
- Credit consumption not yet visible (billing lag); re-read later with `aws freetier get-account-plan-state`.
- Credit watchdog's *failure* path (poweroff on breach) not deliberately triggered; external Scheduler stop not observed firing (the instance was stopped first; it will fire harmlessly at 13:25:30 UTC).
- 2 real-Qwen Python tests require the Windows Ollama runtime and were not rerun on Windows; EC2 Qwen was verified by the 40-case benchmark.
- Full Linux regression container not rerun on EC2 (unchanged evidence: 460 local Linux); EC2 acceptance covered the deployed images.
- CPU latency (≈30 s answers, ≈70 s cold) is a hardware limit, not a defect. No public HTTPS site exists.
- Optional S3 original export remains unapproved. The DLQ message will expire per its 4-day retention.
- Cleanup (terminate instance, delete volume/roles/SG/schedules) needs your separate approval — see `AWS_BACKUP_AND_ROLLBACK.md`.
