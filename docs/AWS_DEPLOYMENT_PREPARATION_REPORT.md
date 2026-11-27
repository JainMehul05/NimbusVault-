# AWS deployment preparation — verification in progress

Date: 27 November 2026, Asia/Kolkata. Branch: `codex/aws-deployment-preparation`.

**The application has not been deployed to EC2. No new AWS resources or live resource changes are authorized or performed in this preparation phase.** The original standalone baseline remains commit `2c9083696f2fe79e2cf5528f9d39cbdefbb36905`, tag `nimbusvault-standalone-baseline-20261127`.

## Standalone independence and recovery

The new preparation branch retains the Windows fallback, project-local runtime, models, databases and original startup/setup commands. A new hash comparison again matched all copied Windows Ollama files, Qwen model files and MiniLM cache files to `cloudvault-backup`. All six content-addressed Qwen blobs are checked against their names. No runtime reparse-point dependency was found in the audited locations.

The separate recovery directory was rechecked: preserved non-database file hashes match, and all rows in each of five original SQLite databases match the recovery copies; each copy passed SQLite integrity checking. The original project's private data and conversations remain in those copies. This is a local recovery copy, not an off-device disaster-recovery guarantee. Private manifests are deliberately excluded from Git.

`nimbus vault final` remains the required working project source directory. Neither original directory supplies runtime files. **Do not delete either retained directory during this deployment task.** The user explicitly prohibited permanent deletion. Removal of an archival source copy is distinct from proving runtime independence and must retain a validated recovery copy.

## Linux rehearsal evidence

All results here are Docker Desktop Linux results, not EC2 acceptance:

| Check | Observed result |
|---|---|
| Python regression | 83 passed, including real Qwen generation, on hardened Trixie application code |
| Backend regression | 298 passed, 13 suites |
| Frontend regression | 57 passed in Linux |
| Infrastructure regression | 22 passed; full combined Node harness exited successfully |
| Browser | 54 SPA route/viewport combinations; no page errors |
| Authentication | Real login; wrong password and cross-account access rejected |
| Cookie isolation | Cloud cookie and existing Windows cookie coexist without overwrite |
| Application RAG | Real generated answer covering two seeded synthetic documents with both citations |
| Initial Linux search benchmark | 84 queries across three modes; hybrid 69/69 relevant top-1, 15/15 negative abstention; zero scope leaks |
| Initial Linux AI benchmark | 38/40; two correction-timeout cases remain subject to full replay after fix |
| Native runtime | Linux x86-64 CPU executable; model digest verified; zero VRAM reported |
| Active shutdown | Observed generation cancelled with HTTP 499; API exit 0, no OOM, 11.03 seconds |
| Restart | Full stack restarted; login, file counts, saved conversation and hybrid search persisted |
| Backup restoration | All rows in all 12 PostgreSQL public tables matched the restored database; SQLite integrity passed |

The initial Python correction-timeout implementation omitted a settings import; regression caught it, the import was fixed, and all 83 Python tests subsequently passed. The initial frontend verification image lacked writable Vite temporary directories and infrastructure test dependencies; both were fixed and the full combined harness passed. An optional Vitest disk-cache warning remains; tests ran without that cache.

Seeded local file metadata and MiniLM indexing demonstrate retrieval and RAG; they do **not** prove S3 upload/download or native AWS event processing. LocalStack tests do not prove real AWS services.

## Read-only AWS verification

The signed-in default profile established identity, FREE/ACTIVE plan, USD139.997874 remaining credits and expiration on 24 May 2027. These are point-in-time observations. Sydney has no existing EC2 instances. The requested instance type is offered and Free-Tier eligible; launch DryRun returned `DryRunOperation`, which did not launch an instance.

Existing queues now both respond to read-only inspection. An earlier report counted 12 service checks as all verified despite two queue timeouts; this report corrects that distinction. Sixteen other enabled regions were not fully inventoried because of authorization restrictions. Free Tier usage returning zero rows does not prove zero account usage.

Scoped IAM simulation denied account-plan upgrade, arbitrary launch, legacy deletion and unconditional original overwrite, while permitting create-only conditional upload. Actual EC2 role permissions, IMDS restrictions, SSM reachability and Free-plan API access still require post-approval validation.

## Security, cost and approval boundary

The first image scan found two critical OS findings. Updated pinned Debian Trixie runtime images removed those critical findings. Unneeded pip/ensurepip and npm build tooling are excluded from production runtime images. Further available OS security updates are being applied. Residual high findings must be disclosed with version, vendor status and exposure analysis; this is not a vulnerability-free certification.

The cost report and architecture describe a proposed single host, private SSM access, scoped role, no public ingress, boot-scoped stop timer and separately approved external deadline/idle-restoration schedules. No `approved-instance.json` or valid runtime authorization exists, so operator commands cannot start an instance.

## Remaining before cloud acceptance

Complete final image scans, combined regression, full AI benchmark replay, active shutdown/restart, backup restore and sanitized bundle checks. Then present one consolidated exact resource/cost/security proposal. Only after explicit approval may resources be provisioned and EC2 benchmarks, real uploads, native workflows, IAM-role integration, persistence, external safeguards and final stopped state be verified.

Until that evidence exists, there is no final AWS deployment certification, cloud benchmark pass or cloud handover claim.
