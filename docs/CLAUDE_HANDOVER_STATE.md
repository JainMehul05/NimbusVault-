# Codex → Claude handover state

Recovered 27 November 2026 (≈14:30 IST) from persisted evidence, not from Codex's narrative. Evidence paths are under `.runtime/aws-deployment/` (private).

## Source state
- Branch `codex/aws-deployment-preparation` at `2c90836` (= verified standalone baseline). All Codex deployment work was **uncommitted** (18 modified, 30+ untracked files); committed as a preparation checkpoint by Claude.
- Application source (backend/intelligence/frontend) last changed 11:00:45 IST; every regression and benchmark below ran after that, so the evidence covers current app code. Only ops scripts/docs changed later.

## Completed and verified from evidence (local Linux Docker, **not EC2**)
| Item | Result | Evidence |
|---|---|---|
| Linux regression | backend 298, frontend 57, infra 22 (`linux-regressions-complete.log`, 11:09); Python 83 (`linux-python-verified.log`, 11:03) = 460 across separate runs | logs |
| Windows rerun | backend 298, frontend 57, Python 81 non-generation (2 generation tests deselected), build/lint/backup OK | `windows-*-final.log` |
| Corrected 40-case Qwen replay | **40/40 strict**, 31/31 genuinely generated, 9/9 correct abstentions, 0 quotation / 0 permission failures, median 19.9 s, 0 AWS calls. Finished 05:59 UTC. The earlier 38/40 run (2 extractive fallbacks from the 30 s correction timeout) is superseded | `linux-ai-40-final.json` |
| 84-query search (Linux) | Hybrid top-1 69/69, top-3 69/69, Recall@3 98.55%, MRR 1.0, negatives 15/15, median 9.1 ms / p95 12.6 ms. Dense top-1 65/69 (94.2%), negatives 15/15. BM25 top-1 64/69, negatives 8/15. 0 unauthorized results | `linux-search-84-final.json` |
| Lifecycle | active generation cancelled → HTTP 499, clean exit 11.03 s, full restart preserved data | `linux-lifecycle.json` |
| Backup | PostgreSQL restore 12/12 tables row-match, SQLite integrity ok | `linux-backup.json` |
| Originals | 5 original SQLite DBs re-verified unchanged | `standalone-recheck.log` |
| IAM | read-only policy simulation: deny upgrade/launch/delete/overwrite/other parameters; allow create-only put and exact parameters | `iam-policy-final.json` |
| Launch | `RunInstances` dry run permitted; no instance created | `launch-dry-run.json` |

## Claude corrections during recovery
1. **Stale bundle.** The 3.1 GB bundle held an older Ollama image (`3ee375…`) and older deployment scripts. Rebuilt: images `api 50c796…`, `intelligence 667bc4…`, `ollama-cpu 421145…`, `postgres cc123b…`; 345 files; every file re-hashed against `FILES.json` with 0 mismatches; Ollama blobs content-address verified. New `images.tar.gz` sha256 `3958470e…`, `models.tar` `f530c0e9…`, `source.tar.gz` `7f2d00f3…`; total 3,088,979,761 bytes.
2. **Bundled Ollama smoke test** (`--network none`, read-only, caps dropped): real Qwen2.5 3B, digest `357c53fb…`, Q4_K_M, context 6144, `size_vram` 0, Ollama 0.40.18.
3. **Host installer defect.** Ubuntu 24.04 has no `awscli` package (packages.ubuntu.com: not available in noble), so `install-host.sh` would have failed and the credit watchdog would have had no CLI. It now installs official AWS CLI v2 and requires a `VALIDSIG` from the pinned AWS CLI team key (fingerprint `FB5DB77FD5C118B80511ADA8A6310ACC4672475C`, verified locally). The watchdog unit now has a private writable HOME so a read-only filesystem cannot cause a false poweroff.
4. **Account finding.** EBS encryption-by-default is off. The launch must set `Encrypted=true` explicitly.

## AWS state (read-only, 27 Nov 2026)
FREE / ACTIVE, USD 139.997804 credits, expires 2027-05-24. No EC2 instances in Sydney. `m7i-flex.large` Free-plan eligible in 2a/2b/2c. Latest Canonical noble AMI still `ami-048c1a9eb63a67eed` (2026-11-20, no product code). Upload rule DISABLED, SQS→Lambda mapping Disabled (batch 1, max concurrency 2). Ingestion queue 0/0, visibility 180 s, redrive maxReceive 3. DLQ: 1 message, retention 4 days, **which means AWS will expire the historical message on its own**; it cannot be kept indefinitely without receiving it, and that is prohibited. Both SQS reads succeeded this time (the earlier two timeouts are now resolved for reads). Prices unchanged: USD 0.1197/h, IPv4 0.005/h, gp3 0.096/GiB-month.

**No AWS resources have been created or modified by Codex or Claude.**

## Local processes
Codex's local Linux stack `nimbusvault-ec2` (postgres/intelligence/api/ollama) is still running in Docker Desktop with synthetic data only. No benchmark process is running. Disk C: is at 99% (≈4 GB free). Docker build cache holds about 21 GB that could be reclaimed, but it was left in place because some of it belongs to other projects.

## Not yet done (requires approval)
Everything on EC2: provisioning, deployment, native workflow, EC2 benchmarks, browser checks, stop/start, performance, final reports. The pending item is the approval decision in `docs/AWS_DEPLOYMENT_APPROVAL_PROPOSAL.md`.
