# NimbusVault — continuation instructions for coding agents

Read `docs/CLAUDE_HANDOVER_STATE.md` first; it is the current state. Then `RESUME_CHECKPOINT.md`, then `.runtime/aws-deployment/state.json` (private, never publish).

## Architecture
- `frontend/` React + TypeScript + Vite + Tailwind (NimbusVault branding — do not redesign).
- `backend/` Express + TypeScript + Prisma + PostgreSQL; JWT + rotating refresh sessions, files/folders, sharing, inheritance, trash.
- `intelligence/` FastAPI: extraction, chunking, MiniLM-L6-v2 (384-d), BM25, hybrid (default), Ollama Qwen2.5 3B Q4_K_M RAG with citation/quote validation. Authenticated by `INTERNAL_SERVICE_TOKEN`.
- AWS (existing, reuse, never duplicate): S3 `cloudvault-d0c2b49b4347` (`cloudvault/files/`), S3 Vectors, DynamoDB `cloudvault-v3-dev`, Lambda/SQS/DLQ/Step Functions/EventBridge/API Gateway/Parameter Store, CloudFormation stack `cloudvault-v3-dev`.
- EC2 deployment: `deployment/` (Linux Dockerfiles, `compose.ec2.yml`, systemd units, host scripts). Bundle builder `scripts/prepare-ec2-bundle.py` → `.runtime/aws-deployment/bundle/` (private, local only).

## Baselines
- Verified Windows standalone: commit `2c9083696f2fe79e2cf5528f9d39cbdefbb36905`, tag `nimbusvault-standalone-baseline-20261127`. Never reset to it; never break it.
- Deployment branch: `codex/aws-deployment-preparation` (no worktrees).
- Windows: `npm start | setup | warmup | stop | backup`, app at `http://127.0.0.1:3100`. Cloud (after approval): `npm run aws:start|connect|status|warmup|stop|backup`, private SSM forward to `http://127.0.0.1:3200`.
- Windows AI runtime lives under `.runtime/standalone-ai/`; never reintroduce `Downloads\cloudvault*` dependencies.

## Testing
- Linux regression: `deployment/compose.regression.yml` (disposable DB + LocalStack). Backend 298, frontend 57, Python 83, infra 22.
- Benchmarks: `scripts/benchmark-search.py` (84 queries), `scripts/benchmark-ai.py` (40 strict cases). Never edit judgments/expected outputs; extractive fallback is not generation.
- Never run destructive suites against the deployed DB or real AWS.

## Hard rules
- ₹0 out-of-pocket. Never upgrade the AWS Free plan, never use Organizations, Marketplace, Bedrock/paid AI, RDS, ECS, NAT, LB, Elastic IP.
- **No AWS mutation without the user's explicit chat approval of a concrete scope.** Full Access / terminal permission is not AWS authorization. Record each approval in `.runtime/aws-deployment/authorization.json` and every resource in the ledger.
- Check identity + FREE/ACTIVE + expiry + credits (reserve USD10) before any approved mutation.
- Never delete originals, DynamoDB records, vectors; never purge queues; never receive/replay DLQ messages.
- EventBridge rule `cloudvault-v3-dev-uploads` and the SQS→Lambda mapping are intentionally **disabled** while idle; restore after any rehearsal.
- Never copy personal AWS credentials, private DBs, conversations or `C:\Users\hp\Downloads\cloudvault-recovery-*` anywhere. Do not touch `Downloads\ip`.
- Production OCR and permanent purge stay disabled. No GitHub push without explicit approval.
- Leave EC2 stopped at the end of every session and verify the actual state.

## Continuation procedure
1. `git status`, `git log -3`, read handover + state.json.
2. Read-only: `aws sts get-caller-identity`, `aws freetier get-account-plan-state --region us-east-1`, `aws ec2 describe-instances` (no duplicates if context was lost).
3. Resume the exact `next_action`; update `RESUME_CHECKPOINT.md`, state.json and the handover after each milestone.
