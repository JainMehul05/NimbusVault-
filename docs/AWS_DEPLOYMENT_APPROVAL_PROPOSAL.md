# Consolidated AWS deployment proposal — awaiting explicit approval

Revised by Claude on 27 November 2026 after recovering Codex's state, rebuilding the stale bundle and rechecking AWS read-only. **Nothing here is authorized until the user approves it in chat.**

## Preconditions verified (read-only, today)
FREE / ACTIVE, USD 139.997804 credits, plan expiry 2027-05-24. Zero EC2 instances. `m7i-flex.large` Free-plan eligible. Upload rule DISABLED, SQS→Lambda mapping Disabled, ingestion queue empty, DLQ holds 1 historical message. Local Linux evidence: 460 regression tests, 40/40 Qwen, 84-query search at baseline. Bundle rebuilt and hash-verified (3.09 GB).

## Resources to create (exact)
| # | Resource | Specification |
|---|---|---|
| 1 | EC2 instance | 1 × `m7i-flex.large` On-Demand (2 vCPU, 8 GiB, x86-64), `ap-southeast-2a`, AMI `ami-048c1a9eb63a67eed` (Canonical Ubuntu 24.04, owner 099720109477, no product code). Tag `NimbusVaultDeployment=nimbusvault-ec2-demo-20261127`. IMDSv2 required, hop limit 2. Shutdown behaviour = **stop**. No key pair |
| 2 | EBS root | **20 GiB gp3, `Encrypted=true` set explicitly** (account default is off), AWS-managed key, kept after stop. Measured peak need is about 10 GB: OS 3 + bundle 3.1 + models 2.0 + images ~1.2. Codex's draft said 30 GiB. 20 GiB saves USD 0.96/month while stopped |
| 3 | Security group | `nimbusvault-ec2-demo` in the default VPC. **No inbound rules.** Outbound TCP 443 only |
| 4 | Public IPv4 | Auto-assigned (needed for outbound HTTPS/SSM without a NAT). Released on stop. No Elastic IP |
| 5 | App IAM role + instance profile | `nimbusvault-ec2-demo-20261127`: scoped inline policy (reviewed draft: exact bucket prefixes, table, vector index, status route, 3 parameters, read-only diagnostics, `freetier:GetAccountPlanState`) plus `AmazonSSMManagedInstanceCore`. Explicit denies: plan upgrade, RunInstances, IAM/CFN changes, all deletes, queue purge/DeleteMessage, unconditional overwrite of originals, other parameters |
| 6 | Safety role | `nimbusvault-ec2-safety-20261127`, trusted only by EventBridge Scheduler in this account. Allowed: stop this one tagged instance, disable the one upload rule, disable the one mapping |
| 7 | 3 one-time Scheduler schedules | `…-stop-` at T+230 min (an external stop that does not depend on the host). `…-restore-rule-` and `…-restore-consumer-` 15 min after the native window opens, which returns the pipeline to idle even if I am interrupted |
| 8 | Temporary S3 objects | ≤ 3.2 GB bundle under `cloudvault/deployment/nimbus/20261127/`. This is outside the EventBridge prefix `cloudvault/files/`, so it cannot trigger processing. **Deleted with your admin profile after the host verifies the hashes** (the bucket is unversioned, so nothing lingers) |

## Temporary changes to existing resources
- Enable rule `cloudvault-v3-dev-uploads` and the SQS→Lambda mapping for **one native window of 15 minutes or less**. Before enabling, the queue must read empty twice and the Windows app must not be writing to the cloud. Afterwards they are restored to disabled and verified; the scheduled restore is the backstop.
- Synthetic writes: ≤ 3 new originals in `cloudvault/files/` (≤ 1 MiB total, approved non-sensitive fixtures, create-only), resulting DynamoDB records, ≤ 3 Step Functions executions, ≤ 5 restricted S3 Vectors queries. No vector uploads, no overwrites or deletions of originals, no DLQ receive, replay or failure injection.

## Session bounds and financial guard
- **Session A: maximum 4 hours** from approval. The host boot timer powers off at 3 h 45 min, the external schedule stops at 3 h 50 min, and a credit watchdog runs every 2 minutes. The watchdog stops the instance if the identity is wrong, the plan is not FREE/ACTIVE, the plan is expired, credits are unknown, credits are ≤ USD 10, or this session has consumed ≥ USD 10.
- Order of work: upload the bundle from the laptop **before** launch so no compute time is spent waiting; deploy; smoke-test; native workflow; 84-query and 40-case benchmarks; browser checks; shutdown and stop/start; then stop.
- If the work does not fit, I stop the instance and ask you for a separate **Session B (≤ 3 h)**. Nothing restarts automatically.

## Estimated credit use (live Sydney prices)
| Item | Session A (4 h) | Each month while stopped |
|---|---:|---:|
| Compute 4 h × 0.1197 | 0.48 | 0 |
| Public IPv4 4 h × 0.005 | 0.02 | 0 (released) |
| gp3 20 GiB × 0.096 | 0.01 prorated | **1.92** |
| Temporary S3 bundle (deleted same day), PUT/GET requests, in-region transfer | < 0.05 | 0 |
| Lambda / SQS / Step Functions / Logs / Scheduler / Vectors at this volume | < 0.20 | ~0 |
| **Total** | **≈ USD 0.75** (cap USD 10) | **≈ USD 1.92** |

Credits are not cash. On the Free plan, AWS does not charge a card when credits run out; the account closes at the end of the plan unless it is upgraded, and **I will never upgrade it**. Billing data lags by hours, so the watchdog and caps are operational safeguards, **not a guaranteed hard cap**. The EBS volume keeps using about USD 1.92/month until you choose to delete it, roughly USD 11.5 through May 2027.

## Access
Access is private only, through SSM port forwarding: `npm run aws:connect` → `http://127.0.0.1:3200`. It requires your AWS login and is **not a public website**. The EC2 cookie name `nimbusvault_ec2_refresh` does not collide with the Windows app.

## Failure handling and rollback
- Any provisioning failure: stop (not terminate) the instance and restore the rule and mapping. Every created ID goes into `.runtime/aws-deployment/resource-ledger.json`.
- A dry-run cleanup list will be prepared. Termination or deletion of the role, SG or schedules happens only with your later approval.
- The original stack, data, vectors and queues are never targeted.

## Residual risks disclosed
- Unfixed upstream CVEs: one scanner-critical libxml2 (PostgreSQL, internal-only) and 22 HIGH identifiers, OpenSSL being the most relevant. All have no stable Debian fix. Details in `AWS_DEPLOYMENT_SECURITY.md`.
- Unverified until EC2: whether 8 GiB holds under load (container caps total 7.0 GiB), CPU latency (local Linux median 19.9 s per answer, EC2 may be slower), the instance role's access to the Free plan API, and enforcement of the host metadata firewall. There is a short window at boot before the iptables rule is reapplied; the API container also has `AWS_EC2_METADATA_DISABLED`.
- The DLQ's historical message has 4-day retention, so AWS will expire it regardless. It cannot be preserved permanently without receiving it, which is prohibited.

## Excluded
Paid plan or upgrade; Organizations; Marketplace; Bedrock or paid AI; RDS/ECS/NAT/LB/EIP; public ingress or SSH; domains; vector uploads; private data migration; S3 original export (separate decision); deletion of anything existing; GitHub push.
