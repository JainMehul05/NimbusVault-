## Session B additions (27 Nov 2026, UTC)
| Service | Responsibility | Test | Result | Class |
|---|---|---|---|---|
| Amazon API Gateway (HTTP API `d00xx7hyr7`) | Public HTTPS entry, AWS certificate, throttling 20/40 | Public browser + API suites 11:33–12:37 | All pass; cert `*.execute-api.ap-southeast-2.amazonaws.com`; direct EC2 ports refused | Live-new |
| API Gateway VPC link | Private path into the VPC | Every public request | Works; its SG egress only to app 8080 | Live-new |
| AWS Cloud Map (HTTP namespace) | Resolves the EC2 private IP:8080 for the integration | Every public request | Works | Live-new |
| Amazon CloudFront | Preferred `*.cloudfront.net` URL | VPC origin 11:09 → Deployed; distribution 11:21 | VPC origin Deployed; **distribution blocked pending AWS account verification** | Blocked |
| EventBridge Scheduler | Session stop, idle restore, safeguard test | Test schedule 12:31:31 | StopInstances by the safety role; auto-deleted | Live-new |
| EC2 / EBS / SSM | Startup cycles and watchdog | 3 ordinary cycles; watchdog poweroff 12:25 | Ready 40–46 s; InstanceInitiatedShutdown | Live-new |
| S3 / EventBridge / SQS / Lambda / Step Functions / DynamoDB / CloudWatch | Native workflow from the public site | 11:58:01–11:58:55 | SUCCEEDED; job → searchable; 21 log events; idle restored | Live-new |

# AWS cloud acceptance matrix — Session A (27 Nov 2026, UTC)

Classification: **Live-new** = newly exercised today against real AWS · **Config** = configuration read today · **Historical** = earlier evidence only · **Paused** = intentionally idle. Account IDs are redacted. 19 AWS services/resource types are listed; this is not a claim of 19 independent "products".

| Service | Responsibility | Source | Configuration verified | Test & result (time UTC) | Security / financial | State now | Class | Limitations |
|---|---|---|---|---|---|---|---|---|
| EC2 | Hosts the entire app (api, intelligence, ollama, postgres) | `deployment/`, `scripts/aws-launch-session.py` | m7i-flex.large, ami-048c1a9eb63a67eed, 2a, x86_64, 2 vCPU, 7776 MiB, shutdown=stop | Launch 09:35:30; full acceptance; stop 31 s; start→healthy 40 s (10:25); stopped 10:34 | Free-plan eligible; no key pair; 3 stop safeguards | **stopped** | Live-new | CPU-only latency |
| EBS | Persistent OS, DB, index, models | launch script | 30 GiB gp3 encrypted (explicit; account default off), 3000 IOPS | Data/models/conversations survived stop/start; 9.2 GiB used | ≈USD 2.88/month credits while kept; no snapshots | in-use (attached, stopped instance) | Live-new | — |
| VPC | Network for EC2 | default VPC/subnet | default subnet 2a, public IPv4 auto (released on stop), DNS working | Outbound HTTPS to AWS/Ubuntu/CLI worked; no NAT/EIP | Public IPv4 USD 0.005/h only while running | — | Live-new | — |
| Security group | Perimeter | `sg-0fce31aed9cee47dc` | **0 inbound**; egress TCP 443 only | Host listened only on 127.0.0.1:3100 (+DNS stub); sshd disabled | — | attached | Live-new | — |
| IAM | Scoped instance role; safety role | `.runtime/.../runtime-policy-draft.json` | inline scoped policy + SSM core; explicit denies (upgrade, launch, deletes, purge, overwrite, other params); safety role stop/disable only | Role used by intelligence + watchdog; simulation of denies earlier (read-only) | No admin credentials on host; no personal credentials copied | exists | Live-new + Config | Deny paths simulated, not exercised destructively |
| STS | Identity / account pin | `cost_guard.py`, watchdog | — | `assumed-role/nimbusvault-ec2-demo-20261127/i-0569…` from host and container | Guard fails closed on mismatch | — | Live-new | — |
| Systems Manager (Run Command, Session Manager) | Admin + private browser access | `scripts/aws-ssm-run.py`, `aws-runtime.py` | agent 3.3.4793.0, Online in ≤1 s after boot | ~30 commands; port forwarding 3200→3100; reconnect after restart | No inbound ports needed; no paid features | — | Live-new | Requires the user's AWS login |
| S3 | Private originals | `intelligence/app/storage.py` | SSE-S3, full public-access block, unversioned | 3 create-only uploads via EC2 app; content-type, SSE, metadata id, stored SHA-256 matched; presigned downloads SHA-256 matched (10:03–10:07); cross-user download 404; paused cloud → 503 | Create-only puts; no deletes of originals; temp bundle objects deleted | 19 originals (16 untouched) | Live-new | — |
| S3 Vectors | Optional approved-fixture query | `internal.py /cloud/vector-demo` | index minilm-384-v1, 384-d, cosine, float32 | 1 restricted query (10:09): approved canary matched, cosine 0.300 | ≤5 allowed, 1 used; 0 uploads; normal search makes 0 vector calls (benchmarks: 0 AWS calls) | unchanged | Live-new | Not on official Free-plan list page; existing resource |
| DynamoDB | File revisions + job state | `cloud.py`, `worker.py` | cloudvault-v3-dev, on-demand | Job `JOB#cv-0fca…` validated→…→awaiting_local_embedding→**searchable** (conditional update); `FILE#41f3…` record with revision | No deletes | ACTIVE | Live-new | — |
| Lambda | Event dispatch + workflow tasks + API | `infrastructure/worker.py` (deployed code byte-identical) | python3.13, index.handler, 30 s, 256 MB | 6 invocations 10:00–10:30, 0 errors, 0 throttles, max 488 ms | Fixture-hash allowlist preserved | unchanged | Live-new | — |
| EventBridge (rule) | Route native S3 Object Created on `cloudvault/files/` to SQS | `cloudvault-stack.json` | prefix `cloudvault/files/` (excludes derived/deployment) | Enabled 10:03:44, real event delivered, disabled 10:04:10 | Window 0.8 min | **DISABLED** | Live-new | — |
| EventBridge Scheduler | Independent safeguards | launch/native scripts | 3 one-time schedules, safety role | Restore schedules fired 10:18:19 (2 attempts, 0 target errors; mapping LastModified 10:18:35) | 14 M free invocations/month | stop schedule pending 13:25:30 (harmless) | Live-new | Stop schedule not observed firing |
| SQS + mapping | Buffer + Lambda consumer | stack | visibility 180 s, retention 1 d, redrive maxReceive 3, batch 1, max concurrency 2 | Event consumed; queue 0/0 before and after; reads no longer time out | Never purged/received manually | mapping **Disabled** | Live-new | — |
| SQS DLQ | Failed-message isolation | stack | retention 4 d | Count 1 before and after; not received | No replay/failure injection | 1 message | Config + Historical | Message will expire by retention |
| Step Functions | Cloud workflow stages | stack | STANDARD, 6 states with retry/catch | Execution `cv-0fca…` SUCCEEDED in 0.8 s: Validate→Extract(approved plain text)→Persist→AwaitLocalEmbedding | 0 running after | ACTIVE | Live-new | Catch path historical only |
| CloudWatch | Logs/metrics | `/cloud/probe` | log group retention 3 d | 21 log events, 5 REPORT lines in window; metrics Invocations 6/Errors 0 | No custom metrics | — | Live-new | Metrics delayed minutes |
| API Gateway | IAM-protected status API | `cloud.py signed_get` | HTTP API, 3 routes AWS_IAM, throttle burst 2 / rate 1 | Signed GET /status from EC2 role ok; unsigned 403 (10:08) | — | unchanged | Live-new | — |
| Parameter Store | Shared config | `/cloud/probe` | 3 Standard String parameters | 3 read with instance role; other parameters explicitly denied | No Advanced params | unchanged | Live-new | — |
| CloudFormation | Stack inventory | read-only | cloudvault-v3-dev UPDATE_COMPLETE, 19 resources | Listed by EC2 role for parameter names | Not updated/deleted | unchanged | Config | — |

Historical correction: the earlier "12 services checked" claim included two SQS timeouts; today both SQS reads and the native SQS delivery succeeded.
