# Verified AWS inventory — CloudVault 3.0

Region: **ap-southeast-2 (Sydney)**. Private identifiers are in `.runtime/cloud-resources.json`, not browser credentials. These are actual resources and successful operations, not a proposed architecture. Event routing and consumption are paused between rehearsals.

| Service | Actual resource/use | Verification and boundaries |
|---|---|---|
| S3 | Existing private bucket; UUID originals under `cloudvault/files/`; private derived prefix | Original download bytes verified. Existing bucket is outside the stack; public blocking preserved. |
| S3 Vectors | Dedicated vector bucket, `minilm-384-v1`, cosine/384D | Create/Put/Get/List/Query succeeded. Existing embeddings migrated without recomputing. Live search and RAG execute QueryVectors. |
| DynamoDB | `cloudvault-v3-dev`; workspace/file and job rows | Conditional writes/read-back; live metadata listing; durable job state and tombstones. On demand, no streams/PITR/GSI. |
| Lambda | One `cloudvault-v3-dev-worker`, Python 3.13, 256 MB, 30 s | Real dispatcher, bounded extraction/classification, workflow tasks and metadata API. No models or private text in logs. |
| SQS | Standard ingestion queue + DLQ | Batch 1, partial failure responses, maximum concurrency 2; visibility 180 s, redrive after 3 receives. Consumer disabled at handover. |
| EventBridge | Exact original bucket/prefix ObjectCreated rule | Native S3 event routed through SQS to the workflow. Derived prefix excluded. Rule disabled at handover. |
| Step Functions | Standard workflow with Catch/terminal failure | Validates object, extracts approved text or classifies, persists manifest, records awaiting-local state. Actual success and failure histories inspected. |
| CloudWatch | Native Lambda metrics + structured logs | Real invocation/error/duration data, 3-day log retention. Snapshot timestamps displayed. Missing datapoints are unavailable, never invented zeros. |
| API Gateway | HTTP API, GET `/files`, `/jobs`, `/status` | Every route AWS_IAM; unsigned 403 and SigV4 200 verified. Throttle 1 rps/burst 2. No anonymous file access. |
| SSM Parameter Store | Three Standard non-secret configuration parameters | Actual GetParameter reads; configuration cached locally. No secrets or Advanced parameters. |
| CloudFormation | `cloudvault-v3-dev`, 20 resources | Reviewed change sets applied incrementally. Existing original bucket, metadata table and vector data remain external. |
| IAM / STS | Separate scoped worker/workflow roles; existing temporary login | Supporting access controls, not extra document-processing integrations. No permanent key created or paid plan upgrade. |

Only the two hash-approved non-sensitive fixtures permit plaintext derived cloud artifacts. Other uploaded originals remain in S3, while full extracted text, local fallback vectors and conversations remain on the laptop. Cloud vectors include embedding metadata; they should still be treated as private data.

Optional SNS, Textract, EC2, RDS, NAT, OpenSearch and paid inference were not provisioned. Bedrock had a known account restriction and was not made a dependency. There is no public frontend deployment.

Evidence: `AWS_GATE1_VERIFICATION.json`, `AWS_API_VERIFICATION.json`, `AWS_WORKFLOW_VERIFICATION.json`, `AWS_WATER_RESTORATION_VERIFICATION.json`, `AWS_FAILURE_VERIFICATION.json`, `AWS_MONITORING_VERIFICATION.json`.
