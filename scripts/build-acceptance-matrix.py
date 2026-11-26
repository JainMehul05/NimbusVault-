"""Build an evidence index without making any cloud request."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
detail = json.loads((root / "docs/AWS_DETAILED_READ_AUDIT.json").read_text())
entries = [
    (
        "Amazon S3",
        "Existing private original bucket and managed prefix",
        "Authoritative original bytes",
        "backend/src/common/storage.ts; intelligence/app/storage.py",
        "Authenticated final-app multipart upload and download SHA256",
        "Same immutable original bytes and private access",
        "242-byte canary hash matched; original objects preserved",
        "AWS_REHEARSAL.json",
        "2026-11-26T14:59:01Z",
        "Guarded normal storage access",
        "Live-verified through NimbusVault",
        "No additional unsupported-format live upload; local integration tests cover it",
    ),
    (
        "DynamoDB",
        "Existing workspace metadata table",
        "Cloud file metadata, revisions, workflow job history",
        "intelligence/app/cloud.py; infrastructure/worker.py",
        "Final-app scoped completion and metadata readback",
        "Matching stable file UUID and searchable job state",
        "Readback/hash and completed count verified",
        "AWS_REHEARSAL.json",
        "2026-11-26T14:59:11Z",
        "Metadata sync enabled; native consumers paused",
        "Live-verified through NimbusVault",
        "PostgreSQL controls users/permissions/folders; no shared ownership authority",
    ),
    (
        "Lambda",
        "Existing serverless worker",
        "Event dispatch, object validation/classification, metadata, cloud API",
        "infrastructure/worker.py",
        "Native final-app upload correlation; deployed code-package comparison",
        "Bounded execution and canonical deployed handler",
        "Actual invocation; deployed source and ZIP hash match local preserved source",
        "AWS_REHEARSAL.json; DEPLOYED_SOURCE_AUDIT.json",
        "2026-11-26T17:21:40Z",
        "Active, 256 MiB, 30 s; consumer disabled",
        "Live-verified through NimbusVault; live-verified independently",
        "Private text extraction stays local; cloud plaintext is hash-approved fixture only",
    ),
    (
        "EventBridge",
        "Existing original-upload rule",
        "Native finalized S3 event routing to existing queue",
        "infrastructure/cloudvault-stack.json",
        "Actual application upload plus correlated native workflow; current rule/target read",
        "Managed bucket/prefix only; no staging/derived recursion",
        "Correct prefix/queue target; restored DISABLED",
        "AWS_REHEARSAL.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "DISABLED",
        "Live-verified through NimbusVault; intentionally paused",
        "Further enabling/rehearsal needs fresh authorization",
    ),
    (
        "SQS",
        "Existing ingestion queue and mapping",
        "Buffer native events and bounded partial-batch dispatch",
        "infrastructure/worker.py; infrastructure/cloudvault-stack.json",
        "Native delivery/consumption plus current queue/mapping read",
        "Finite redrive, batch 1, maximum concurrency 2",
        "Visibility 180 s, max receives 3, partial-batch failures enabled, queue empty",
        "AWS_REHEARSAL.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "Mapping Disabled",
        "Live-verified through NimbusVault; intentionally paused",
        "No continuous polling or unknown-backlog consumption",
    ),
    (
        "SQS DLQ",
        "Existing dead-letter queue",
        "Failed-message isolation and reviewed recovery",
        "infrastructure/cloudvault-stack.json; docs/donor-cloudvault/AWS_LIVE_VERIFICATION.md",
        "Current redrive/retention/backlog read; historical controlled redrive",
        "Failures isolated without unbounded retry",
        "One retained historical test message; max receives 3; no purge",
        "AWS_DETAILED_READ_AUDIT.json; donor AWS_FAILURE_VERIFICATION.json",
        "2026-11-26T17:17:55Z",
        "One retained message; no redrive active",
        "Configuration verified; previously live-verified through CloudVault",
        "24 Nov driver used bounded local SQS receives; deployed Lambda rejection tested separately, not an end-to-end poison-message experiment",
    ),
    (
        "Step Functions",
        "Existing Standard workflow",
        "Validation, classification, persistence, awaiting-local boundary and Catch",
        "infrastructure/cloudvault-stack.json; intelligence/app/cloud.py",
        "Native final-app execution and current definition/history counts",
        "Finite retry/Catch; no request into localhost",
        "Actual native stages; four succeeded/one failed histories; zero running",
        "AWS_REHEARSAL.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "ACTIVE; zero running executions",
        "Live-verified through NimbusVault; failure history previously verified through CloudVault",
        "Awaiting-local marker terminates cloud stages; local outbound reconciliation updates metadata separately",
    ),
    (
        "CloudWatch",
        "Existing worker logs and AWS metrics",
        "Execution observability, timestamps and bounded diagnostics",
        "intelligence/app/internal.py; scripts/verify-aws-detail.py",
        "Final-app logs/Invocations; independent Errors/Duration read",
        "Real datapoints or explicit unavailable; short retention",
        "5 previously sampled native events, 11 prior-window invocations; latest Errors/Duration datapoints: "+json.dumps(detail['checks']['cloudwatch_metrics'],default=str),
        "APP_CLOUD_PROBE.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "3-day log retention; on-demand reads",
        "Live-verified through NimbusVault; live-verified independently",
        "Historical window metrics, not continuous health or fabricated current counts",
    ),
    (
        "API Gateway",
        "Existing IAM HTTPS metadata/status API",
        "Guarded operational cloud status; optional metadata adapter",
        "intelligence/app/cloud.py; intelligence/app/internal.py; infrastructure/worker.py",
        "Final-app SigV4 signed and unsigned status calls; route/throttle inspection",
        "AWS_IAM required; unsigned rejected",
        "Signed status succeeds; unsigned 403; routes retain AWS_IAM/throttles",
        "APP_CLOUD_PROBE.json; AWS_DETAILED_READ_AUDIT.json",
        "2026-11-26T15:24:38Z",
        "Existing endpoint available on demand",
        "Live-verified through NimbusVault",
        "Normal file metadata uses direct scoped DynamoDB path; API global lists are not exposed to normal accounts",
    ),
    (
        "S3 Vectors",
        "Existing 384D cosine index",
        "Explicit restricted synthetic cloud retrieval demonstration",
        "intelligence/app/internal.py; intelligence/app/cloud.py",
        "One final-app QueryVectors plus independent List/Get preservation",
        "Compatible MiniLM and exact approved file/vector filters",
        "Matched canary cosine 0.30029958; original 61 vector payloads preserved",
        "AWS_VECTOR_DEMO.json; PRESERVATION_CLOUD_AUDIT.json",
        "2026-11-26T15:24:25Z",
        "Disabled for normal indexing/search",
        "Live-verified through NimbusVault; PutVectors previously verified through CloudVault",
        "Not a general multi-user cloud corpus search; default local calls zero AWS vectors",
    ),
    (
        "Parameter Store",
        "Three existing Standard parameters",
        "Shared cloud configuration and drift verification",
        "infrastructure/cloudvault-stack.json; intelligence/app/internal.py; scripts/verify-aws-detail.py",
        "Final-app retrieval; current comparison to active table/index/workflow",
        "No missing parameters or incompatible config",
        "Three retrieved; all values match current config; no Advanced parameters",
        "APP_CLOUD_PROBE.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "On-demand; local runtime config cached on disk",
        "Live-verified through NimbusVault; configuration verified independently",
        "Not queried per search and no credentials exposed",
    ),
    (
        "CloudFormation",
        "Existing 20-resource serverless stack",
        "Auditable resource relationships/deployed configuration",
        "infrastructure/cloudvault-stack.json; scripts/verify-aws-detail.py",
        "Read-only stack/resources and template/source review",
        "Existing stack preserved; no replacement/deployment",
        "UPDATE_COMPLETE; 20 resources; current types inventoried",
        "AWS_CURRENT_STATUS.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "Existing deployed stack unchanged",
        "Configuration verified; live-verified independently",
        "Original NimbusVault production CDK remains inactive; no new deployment",
    ),
    (
        "IAM / STS",
        "Existing temporary profile and two execution roles",
        "Cloud identity, signed APIs, resource-scoped service permissions",
        "intelligence/app/cost_guard.py; intelligence/app/cloud.py",
        "Current STS/account guard, role trusts and inline-policy reads; signed API denial/success",
        "Approved account, no permanent keys, no privilege expansion",
        "Temporary identity matches workflow account; Lambda/States role trusts; no allow-all-action statement",
        "AWS_CURRENT_STATUS.json; AWS_DETAILED_READ_AUDIT.json",
        detail["observed_at"],
        "Default temporary profile; renewal owned by user",
        "Live-verified through NimbusVault; configuration verified independently",
        "Application-user authorization is separate; no IAM permissions changed",
    ),
]
report = []
for (
    service,
    resource,
    purpose,
    source,
    method,
    expected,
    actual,
    evidence,
    timestamp,
    state,
    status,
    limits,
) in entries:
    report.append(
        {
            "service": service,
            "existing_resource": resource,
            "application_responsibility": purpose,
            "source_implementation": source,
            "verification_method": method,
            "expected_behavior": expected,
            "actual_result": actual,
            "evidence_reference": evidence,
            "verification_timestamp": timestamp,
            "current_runtime_state": state,
            "security_controls": "Backend-only temporary AWS credentials; application permissions; private service token; scoped resources and safe synthetic fixtures.",
            "financial_safeguards": "Current approved account, active Free plan and USD 1 reserve; bounded requests/retries; existing resources only; no upgrade or personal-payment charges authorized.",
            "remaining_limitations": limits,
            "final_verification_status": status,
        }
    )
(root / "docs/AWS_ACCEPTANCE_MATRIX.json").write_text(
    json.dumps(
        {
            "guard_observation": detail["guard"],
            "guard_is_not_hard_billing_cap": True,
            "services": report,
        },
        indent=2,
    )
)
lines = [
    "# AWS acceptance matrix",
    "",
    "Full requested columns are in [the structured matrix](AWS_ACCEPTANCE_MATRIX.json). Existing resource aliases are used here; exact identifiers remain private. No new cloud mutations were performed during continuation.",
    "",
    "| Service | Evidence-backed status | Actual role / remaining limit |",
    "|---|---|---|",
]
for entry in report:
    lines.append(
        "| "
        + entry["service"]
        + " | "
        + entry["final_verification_status"]
        + " | "
        + entry["application_responsibility"]
        + ". "
        + entry["remaining_limitations"]
        + " |"
    )
lines.extend(
    [
        "",
        "Current guard observation: "
        + detail["guard"]["checked_at"]
        + "; FREE / ACTIVE; USD "
        + str(detail["guard"]["credits_usd"])
        + " credits. The guard is not a hard AWS billing cap. EventBridge DISABLED, mapping Disabled, no running workflow, ingestion queue empty, one historical DLQ message preserved. Further cloud writes/rehearsals require fresh owner approval.",
    ]
)
(root / "docs/AWS_ACCEPTANCE_MATRIX.md").write_text("\n".join(lines))
print("Built evidence-backed assessment for 13 AWS service/capability groups; no AWS requests.")
