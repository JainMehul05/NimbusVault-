# AWS acceptance matrix

Full requested columns are in [the structured matrix](AWS_ACCEPTANCE_MATRIX.json). Existing resource aliases are used here; exact identifiers remain private. No new cloud mutations were performed during continuation.

| Service | Evidence-backed status | Actual role / remaining limit |
|---|---|---|
| Amazon S3 | Live-verified through NimbusVault | Authoritative original bytes. No additional unsupported-format live upload; local integration tests cover it |
| DynamoDB | Live-verified through NimbusVault | Cloud file metadata, revisions, workflow job history. PostgreSQL controls users/permissions/folders; no shared ownership authority |
| Lambda | Live-verified through NimbusVault; live-verified independently | Event dispatch, object validation/classification, metadata, cloud API. Private text extraction stays local; cloud plaintext is hash-approved fixture only |
| EventBridge | Live-verified through NimbusVault; intentionally paused | Native finalized S3 event routing to existing queue. Further enabling/rehearsal needs fresh authorization |
| SQS | Live-verified through NimbusVault; intentionally paused | Buffer native events and bounded partial-batch dispatch. No continuous polling or unknown-backlog consumption |
| SQS DLQ | Configuration verified; previously live-verified through CloudVault | Failed-message isolation and reviewed recovery. 24 Nov driver used bounded local SQS receives; deployed Lambda rejection tested separately, not an end-to-end poison-message experiment |
| Step Functions | Live-verified through NimbusVault; failure history previously verified through CloudVault | Validation, classification, persistence, awaiting-local boundary and Catch. Awaiting-local marker terminates cloud stages; local outbound reconciliation updates metadata separately |
| CloudWatch | Live-verified through NimbusVault; live-verified independently | Execution observability, timestamps and bounded diagnostics. Historical window metrics, not continuous health or fabricated current counts |
| API Gateway | Live-verified through NimbusVault | Guarded operational cloud status; optional metadata adapter. Normal file metadata uses direct scoped DynamoDB path; API global lists are not exposed to normal accounts |
| S3 Vectors | Live-verified through NimbusVault; PutVectors previously verified through CloudVault | Explicit restricted synthetic cloud retrieval demonstration. Not a general multi-user cloud corpus search; default local calls zero AWS vectors |
| Parameter Store | Live-verified through NimbusVault; configuration verified independently | Shared cloud configuration and drift verification. Not queried per search and no credentials exposed |
| CloudFormation | Configuration verified; live-verified independently | Auditable resource relationships/deployed configuration. Original NimbusVault production CDK remains inactive; no new deployment |
| IAM / STS | Live-verified through NimbusVault; configuration verified independently | Cloud identity, signed APIs, resource-scoped service permissions. Application-user authorization is separate; no IAM permissions changed |

Current guard observation: 2026-11-26T17:17:55.307453+00:00; FREE / ACTIVE; USD 139.998445 credits. The guard is not a hard AWS billing cap. EventBridge DISABLED, mapping Disabled, no running workflow, ingestion queue empty, one historical DLQ message preserved. Further cloud writes/rehearsals require fresh owner approval.