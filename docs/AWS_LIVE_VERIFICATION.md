# Actual final-application AWS verification

Continuation evidence: the current read-only audit and [full acceptance matrix](AWS_ACCEPTANCE_MATRIX.md) supersede any implication that the initial14:51 configuration observations are continuously current. `AWS_DETAILED_READ_AUDIT.json` verified idle state and configuration at17:17UTC; `DEPLOYED_SOURCE_AUDIT.json` verified exact deployed Lambda bytes at17:21UTC. No additional cloud writes were performed. `AWS_FAILURE_HISTORICAL.json` preserves the genuine24November driver/rejection distinction.

All times below are UTC on 26 November 2026. Evidence is from the final NimbusVault application or its guarded audit scripts, not merely copied donor reports. Exact resource identifiers remain in the private journal; the synthetic file UUID is a sanitized correlation reference.

| Service | State / purpose | Actual operation and timestamp | Result / limitation |
|---|---|---|---|
| S3 | Existing private encrypted originals | Final-app 242-byte multipart upload, 14:59:01; authenticated download | SHA256 `5baf6e09227e3516c398a189c862e4fa3ca7f906542d9a7480d5b6eb610663f8`; bytes equal; fixture `ab7748dd-9c71-44bb-96d7-867d1c5c4e48` |
| EventBridge | Existing rule | Enabled 14:58:39; S3 event routed natively | Actual correlated job; restored DISABLED 14:59:54 |
| SQS / Lambda mapping | Existing queue, disabled consumer | Enabled 14:58:40; native event consumed | Prior empty backlog checked; mapping restored Disabled 14:59:55 |
| Lambda | Active 256 MiB / 30 s | Actual correlated native processing 14:59:02–03 | No function/role/config deployment |
| Step Functions | Existing ACTIVE workflow | Validated, classified, cloud-stage-complete, awaiting-local-embedding at 14:59:03 | Native delivery, not a manual replacement; local completion separate |
| DynamoDB | ACTIVE metadata and job state | Final-app scoped completion 14:59:11 | Searchable state/hash readback verified |
| API Gateway / IAM / temporary identity | Existing IAM-authenticated API | Signed final-app status probe 15:24:38 | Signed success, unsigned 403; owner supplied AWS login, no credentials embedded |
| SSM | Three existing standard parameters | Final-app read probe 15:24:38 | Three retrieved; no parameter contents exported |
| CloudWatch Logs | Existing 3-day retention | Final-app probe 15:24:38 | Five native events observed; no repeated failure injection |
| CloudWatch Metrics | Existing Lambda invocation metric | Final-app sampled 30-minute window at 15:24:38 | 11 observed invocations; not assumed zero when delayed |
| S3 Vectors | Existing 384D index | Fixed approved canary query via final app 15:24:25 | One query matched, cosine 0.30029958; ordinary retrieval local |
| CloudFormation | Existing UPDATE_COMPLETE stack | Read-only inventory 14:51; resource probe 15:24 | Existing resources only; no provisioning/update |

The native journal records correlation `cv-8d150c4c93ef…` with the synthetic file UUID above. The second 134-byte synthetic fixture was used for account-isolation checks; its original SHA256 is in the sanitized rehearsal evidence. All originals were preserved, including the legacy corpus. Read-only preservation at 15:44 found 12/12 legacy originals and 61/61 equivalent vector payloads, with no proposed deletions.

Free-plan verification before rehearsal: FREE / ACTIVE, USD 139.998445 credits, reported expiry 24 May 2027. The account guard validates the configured existing account. The local guard is **not a hard AWS spending cap**; current eligibility is required and unknown/expired status blocks cloud operations. No payment-method charges or account upgrade are authorized. No paid services or new infrastructure were introduced.

Settings were restored and verified before the rehearsal finished at 15:00:06. No queue purge, unrelated execution cancellation, original overwrite or deletion was performed. Historical donor poison/redrive tests were not rerun. Later diagnostics were bounded read-only operations. Additional cloud mutation/rehearsal requires fresh owner approval; signing in alone is not such approval.
