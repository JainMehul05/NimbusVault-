# Cost estimate

Monthly, us-east-1, on-demand, light use (a few users, 50 GB of files). Computed from AWS list prices as known in mid-2026 and **not checked against a bill**; confirm in the [AWS Pricing Calculator](https://calculator.aws) before deploying.

| Item | Production | Staging |
|---|---:|---:|
| Fargate API (0.5 vCPU / 1 GB; staging 0.25 / 0.5) | $18 | $9 |
| Fargate Spot worker (1 vCPU / 2 GB; staging 0.5 / 2) | $11 | $6 |
| Public IPv4 addresses for the two tasks | $7 | $7 |
| Internal Application Load Balancer | $18 | $18 |
| RDS db.t4g.micro, 20 GB gp3 | $14 | $14 |
| Secrets Manager (3–4 secrets) | $2 | $1 |
| CloudWatch logs, metrics, alarms | $4 | $2 |
| S3 (50 GB) and requests | $2 | $1 |
| ECR images | $1 | $1 |
| CloudFront, VPC origin, budgets, gateway endpoint | free tier / free | free |
| **Total** | **≈ $77** | **≈ $59** |

Optional: WAF +$8 · Multi-AZ database +$14 · hosted LLM by usage.

## What was avoided

| Not used | Saving |
|---|---:|
| Two NAT gateways | ≈ $65 plus $0.045 per GB |
| Interface VPC endpoints (4) in two zones | ≈ $58 |
| Public load balancer with its own addresses | ≈ $7 |
| OpenSearch / managed vector database (pgvector instead) | $25–350 |
| Container Insights, always-on GPU, hosted embeddings | varies |

## Keeping it down

- Budget alerts at 50%, 80% and forecast 100% (`monthlyBudgetUsd`).
- No AI needed? `-c aiEmbeddingProvider=none` and scale the worker to 0: −$14.
- Pause staging: `aws ecs update-service --desired-count 0` for both services and `aws rds stop-db-instance` (RDS restarts itself after 7 days).
- New accounts: part of RDS and S3 use may be covered by free-tier credits.
- Finished? [Teardown](aws-deployment.md#teardown), then delete the retained bucket and snapshot.
