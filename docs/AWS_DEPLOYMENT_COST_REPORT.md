## Actual Session A outcome — 27 November 2026

Approved limits: 1 × m7i-flex.large, 30 GiB encrypted gp3, ≤4 h, ≤USD 10 credits, ≥USD 10 reserve. Actual runtime ≈58 min (09:35:30–10:34 UTC incl. restart test). Live Sydney prices rechecked: USD 0.1197/h compute, 0.005/h public IPv4 (released when stopped), 0.096/GiB-month gp3.
Estimated credit use ≈ **USD 0.13** (compute ≈0.12, IPv4 ≈0.005, EBS prorated ≈0.004; S3 temporary bundle ≈3.1 GB for <2 h, PUT/GET, Lambda 6 invocations, 1 Step Functions execution, 1 S3 Vectors query, Scheduler ≤3 invocations — all negligible). Credits read USD 139.997804 before and after (billing lag). Continuing while stopped: 30 GiB gp3 ≈ **USD 2.88/month** of credits. Out-of-pocket ₹0; plan FREE, never upgraded. Temporary S3 deployment objects deleted.

---

# AWS deployment cost proposal

Status: preparation only; no new AWS resources provisioned. Currency is USD credit consumption, not a promise of permanently free hosting. The account was read-only verified FREE/ACTIVE with USD139.997874 remaining and plan expiry 24 May 2027. Recheck immediately before provisioning and each authorized start. The requirement remains **INR0 out of pocket**: never upgrade, join an organization, subscribe to Marketplace products or bypass a denied Free-plan operation.

## Verified regional rates

AWS Price List `GetProducts` responses for Sydney are retained privately in `.runtime/aws-deployment/*pricing.json` and `discovery.json`. Queries used the exact Linux/Shared/NA/Used `m7i-flex.large` product, gp3 storage and in-use public IPv4. No third-party price estimate is substituted for those responses.

| Component | Gross unit rate / treatment |
|---|---|
| EC2 `m7i-flex.large`, Linux shared | USD0.1197/hour |
| Automatically assigned public IPv4 | USD0.005/hour while assigned; released on stop |
| Encrypted gp3, baseline IOPS/throughput | USD0.096/GiB-month; 30 GiB = USD2.88/month |
| Existing S3 Standard storage | USD0.025/GB-month; temporary artifacts proposed below 4 GiB |
| S3 PUT / GET | USD0.0000055 / USD0.00000044 per request |
| DynamoDB standard on-demand writes / reads | USD0.000000710 / USD0.0000001425 per request unit; item size/consistency affect units |
| Lambda x86 compute / requests | USD0.0000166667/GB-second / USD0.0000002 per request |
| SQS Standard | USD0.0000004 per request unit; payload size can multiply units |
| Standard Step Functions | USD0.000025/state transition |
| API Gateway HTTP requests | USD0.00000129/request; REST API is a different rate and is not substituted |
| CloudWatch Logs ingestion / storage | USD0.67/GB ingested / USD0.033/GB-month; existing retention preserved |
| CloudWatch metric API requests | USD0.00001/request where applicable; no custom monitoring subscription proposed |
| S3 Vectors | Existing index only; at most five restricted queries. Catalog request tiers and processed/returned-byte rates are retained in `s3-vector-pricing.json`; no benchmark-vector upload |
| EventBridge native events | Reuse the existing default-bus rule. No custom event bus, Pipes, archive, discovery or new event-evaluation feature |
| EventBridge Scheduler safeguards | Three single-target schedules; published gross rate USD1/million invocations beyond its allowance; no more than one retry each |
| Three existing Standard parameters | Standard storage/standard throughput only; no Advanced parameters or high-throughput setting enabled |
| Session Manager | Standard EC2 session/forwarding; no Advanced/on-premises management, paid monitoring or session-streaming feature |
| VPC, security group, IAM role/profile, STS | Existing VPC/subnet/route; no separately priced NAT gateway, endpoint, load balancer, Elastic IP or managed database |
| Internet egress | Conservatively USD0.114/GB in the first Sydney outbound tier; do not assume the account's shared free allowance is unused |

Rates do not constitute universal service pricing: tiers, item sizes, payload chunks and other account usage matter. AWS Free Tier usage returned zero rows, which is **not proof of zero usage or a zero bill**. Sixteen other enabled regions could not be inventoried because of regional authorization restrictions; Sydney has no existing EC2 instances. Other account activity and billing delay remain uncertainties.

## Bounded initial session

Propose one instance, 30 GiB encrypted gp3, a maximum four-hour authorization and a maximum USD10 initial credit allowance. The boot timer requests OS poweroff at 225 minutes; a separately approved independent Scheduler stop target requests EC2 stop at 230 minutes, leaving a margin before four hours. Runtime and consumption must not be silently extended.

Four hours of EC2 + IPv4 + prorated EBS is **USD0.514581** at the verified rates. This covers initial installation and testing inside the same four-hour session, rather than two separate four-hour sessions. Add a deliberately conservative **USD1 metered-service/transfer allowance**, plus approximately USD0.10 if 4 GB of temporary S3 artifacts are retained for a full month. Keeping the 30 GiB disk for an entire first month makes the illustrative first-month total approximately **USD4.48** including that USD1 allowance. This is an estimate below the proposed USD10 ceiling, not a guaranteed account-wide hard cap.

The native rehearsal proposal permits at most three unique synthetic originals, no more than 1 MiB total original bytes, three workflow executions and five restricted vector queries. No unknown queue receives, poison messages, DLQ replay/purge, legacy overwrite/deletion, full benchmark upload or paid inference. Docker/model packages arrive once through an approved deployment prefix outside `cloudvault/files/`; same-region S3-to-EC2 transfer and inbound transfer are treated according to AWS's published transfer rules. Measured bundle sizes must be recorded before upload. No source/model artifact has been uploaded during preparation.

## Usage scenarios and runway

730-hour illustrative month; daily-use scenarios average 730/24 days. Gross compute + IPv4 + 30 GiB EBS, excluding other services and free allowances:

| Average operation | Running hours/month | Gross USD/month | Arithmetic months until USD10 reserve |
|---|---:|---:|---:|
| Stopped all month | 0 | 2.88 | 45.14 |
| 1 hour/day | 30.42 | 6.67 | 19.48 |
| 2 hours/day | 60.83 | 10.47 | 12.42 |
| 4 hours/day | 121.67 | 18.05 | 7.20 |
| Continuous | 730 | 93.91 | 1.38 |

The Free-plan expiration is earlier than most arithmetic runways. These numbers do not authorize future runtime or imply credits survive the plan. Retained EBS and S3 storage keep consuming credits while EC2 is stopped. AWS documents account closure after Free-plan expiry/credit exhaustion and a limited recovery period, so important private data needs an authorized recoverable export before expiry. Never upgrade merely to retain access without a separate user decision.

## Financial controls and limits

The application now checks identity, FREE/ACTIVE status, expiration, USD currency and reserve, failing closed on unknown state. EC2 requires a minimum USD10 reserve. Successful guard caching cannot outlive plan expiration. Role credentials must successfully call the real plan API on EC2; permission failure is a deployment blocker, not permission to bypass the guard. The role proposal explicitly denies plan upgrade, arbitrary provisioning and preserved-data deletion. IAM simulation verified those denies and the create-only S3 condition.

Timers, credit snapshots and budgets are not guaranteed hard billing caps. Validate actual stopped state and delayed credits after testing; preserve the disk but do not leave compute running. Future starts require a valid, separately recorded bounded authorization and the matching rearmed stop deadline. Permanent cleanup is preview-only unless explicitly authorized.

## Sources

Verified rate evidence: AWS Pricing API responses and query filters in the private preparation directory. Public references: [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [EBS pricing](https://aws.amazon.com/ebs/pricing/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [S3 pricing and transfer](https://aws.amazon.com/s3/pricing/), [EventBridge and Scheduler pricing](https://aws.amazon.com/eventbridge/pricing/), [SSM pricing](https://aws.amazon.com/systems-manager/pricing/), [Free-plan rules and automatic-upgrade triggers](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [GetAccountPlanState](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetAccountPlanState.html), [Free Tier IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_freetier.html).
