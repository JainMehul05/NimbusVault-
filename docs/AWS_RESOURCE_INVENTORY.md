# Existing AWS resources and verified use

Region: `ap-southeast-2`; local profile: `default`. Exact account IDs, bucket/table/index names, ARNs and endpoints remain in private runtime configuration, not this public handover. The existing CloudVault stack was reused; no resources, roles, permissions or paid services were provisioned.

| Resource / capability | Genuine verification | Default idle behavior |
|---|---|---|
| S3 originals | Private-access blocks, encryption; final-app multipart upload, SHA256 readback/download | Guarded authenticated access only |
| DynamoDB | ACTIVE; native job transitions and searchable completion readback | Existing metadata/outbox only |
| EventBridge | Native S3 event drove approved workflow | Restored DISABLED |
| SQS and DLQ | Queue settings and idle state inspected; native consumer exercised | Mapping restored Disabled; no polling worker |
| Lambda | Active, 256 MiB, 30 s; actual native logs and invocation metric | Existing function, no scheduled traffic |
| Step Functions | Existing ACTIVE machine; actual awaiting-local-embedding transition | No new execution loop |
| API Gateway / IAM | Final-app signed status succeeds; unsigned status returns 403 | Manual guarded probe |
| SSM | Three existing standard parameters read via final-app probe | No polling |
| CloudWatch logs | Five actual native log events observed, 3-day retention | Existing retention unchanged |
| CloudWatch metrics | 11 Lambda invocations observed in the sampled 30-minute window | On-demand diagnostics, not fabricated zeros |
| CloudFormation | Existing stack UPDATE_COMPLETE, resources inspected | No deployment/update |
| S3 Vectors | Existing 384D index inspected; one restricted synthetic-canary query matched, cosine 0.30029958 | Disabled for normal ingestion/search |

The FREE/ACTIVE plan was verified before rehearsal, with USD 139.998445 available credits and reported expiry 24 May 2027. These are observations on 26 November 2026, not permanent guarantees. The guard checks current state and a USD 1 reserve before cloud operations, and rejects the wrong account. No account upgrade was requested or performed. Credits do not replace the user's absolute requirement of zero out-of-pocket spending; never bypass the active-Free-plan requirement.

The authorized rehearsal used two tiny uniquely identified non-sensitive synthetic originals through the final application. It verified native routing, local completion, metadata, hashes, permissions, citations and Qwen. It restored the previous EventBridge/SQS configuration in `finally`, and the journal records both prior and restored states. All originals remain; no cleanup deletion was attempted. Queue poison/redrive and infrastructure changes were not repeated; any older donor evidence is historical only.

Evidence: `AWS_CURRENT_STATUS.json`, `AWS_REHEARSAL.json`, `APP_CLOUD_PROBE.json`, `AWS_VECTOR_DEMO.json`, `PRESERVATION_CLOUD_AUDIT.json`. `AWS_PREFLIGHT.json` intentionally retains the initial expired-login failure. Credentials were refreshed by the owner, not supplied to the agent. The journaled write script refuses a second run; further mutations or expanded cloud testing require owner approval.
