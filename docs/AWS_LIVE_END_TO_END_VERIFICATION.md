# Live native AWS workflow from the EC2-hosted application (27 Nov 2026)

One genuine, correlated run. No SQS message was injected; the event came from S3 itself.

| Time (UTC) | Step | Evidence |
|---|---|---|
| 10:03:19 | Preconditions | rule DISABLED, mapping Disabled, ingestion queue 0/0 twice (10 s apart), 0 running executions, DLQ 1 |
| 10:03:21–22 | Independent restore schedules armed for 10:18:19 | `nimbusvault-restore-rule-20261127`, `nimbusvault-restore-consumer-20261127` |
| 10:03:44 | Window open | rule ENABLED, mapping Enabled |
| ≈10:03:45 | User (synthetic owner) uploads `cloud-stage-canary.txt` through the EC2 app (`POST /files`) | file `41f31644-7e3d-44ad-a1ba-3ce128cd19fc`; S3 PutObject (create-only, SHA-256 checksum) |
| ≈10:03:49 | Indexed on EC2 (MiniLM) | aiStatus INDEXED after 9.0 s |
| 10:03:49.062 → .850 | S3 Object Created → EventBridge → SQS → Lambda → **Step Functions** | execution `cv-0fca9374d2bde8b8…` **SUCCEEDED**: ValidateObject → ExtractOrClassify → PersistManifest → AwaitLocalEmbedding |
| 10:03:57 | DynamoDB job | `awaiting_local_embedding`, cloud_extraction `approved_plain_text` (hash allowlisted), sha256 matches upload, derived artifact under `cloudvault/derived/` |
| 10:04:10 | Window closed (finally block) | rule DISABLED, mapping Disabled, queue 0/0, DLQ 1 (unchanged). Window 0.8 min |
| 10:04:12 | CloudWatch | 21 log events, 5 Lambda REPORT lines (e.g. 171 ms, 96 MB used) |
| ≈10:05 | EC2 reconciliation (admin `POST /ai/cloud/complete`) | job → **searchable** (conditional update), `FILE#…` revision record written |
| 10:05–10:07 | Search & RAG | semantic paraphrase "which service keeps the uploaded originals private" → canary top-1; multi-document Qwen answer cites canary [S2] and note [S1], sentences verbatim in snippets |
| 10:07 | Download | presigned GET (120 s TTL) bytes SHA-256 = original |
| 10:18:19 | Scheduler backstop | both schedules invoked (0 target errors); mapping LastModified 10:18:35 |
| 10:08 / 10:30 | Metrics | Lambda Invocations 6, Errors 0, Throttles 0 (includes 1 signed API probe) |

Cloud plaintext extraction stayed restricted to the approved fixture hash; the two other uploads were made with the rule disabled (no cloud processing), keeping arbitrary documents on the private EC2 path. Raw evidence: `.runtime/aws-deployment/ec2-native-workflow.json`.
