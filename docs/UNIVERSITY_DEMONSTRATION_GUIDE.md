> **Public URL (Session B):** https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com — AWS-generated (API Gateway); CloudFront pending AWS account verification. Give the professor the separate invitation code (`professor_invite_code` in `.runtime/public-deployment/public-secrets.json`) or a demo account. See `PUBLIC_DEPLOYMENT_GUIDE.md`.

# University demonstration guide â€” NimbusVault on AWS

Budget â‰ˆ30â€“40 min of instance time (â‰ˆUSD 0.08 of credits). Needs a fresh session approval (see `AWS_DEPLOYMENT_GUIDE.md`).

## A. Live demonstration
1. **Start** by double-clicking **Start NimbusVault AWS.bat** (or its desktop shortcut). Choose the bounded session duration and type **YES** after reviewing the live FREE/ACTIVE plan, remaining credits, estimate and stop safeguards. Allow several minutes for boot and AI warmup.
2. **Wait for SUCCESS**. The launcher checks database/backend/intelligence, host stop timers, fresh MiniLM/Qwen warmup and public HTTPS. It opens the genuine public AWS URL (API Gateway; CloudFront once verified) and prints that shareable URL. No manual PowerShell commands or SSM tunnel are needed for the public demonstration.
3. **Sign in** in the opened website. The manifest now records the AWS API Gateway URL; the launcher opens it after verifying public HTTPS. `npm run aws:connect` remains an advanced private administration tool.
4. **Dashboard / files**: folders, rename, move, share, trash/restore.
5. **Upload** an approved synthetic document *(requires writes enabled + approval of the S3 write)*.
6. **Native AWS processing** *(only within an approved window)*: explain S3 â†’ EventBridge â†’ SQS â†’ Lambda â†’ Step Functions â†’ DynamoDB; show the Step Functions execution and DynamoDB job in the console; CloudWatch logs.
7. **Search**: paraphrase "which service keeps the uploaded originals private" (semantic) and "retention code ORCHID-4471" (hybrid/BM25).
8. **Ask**: "What is the synthetic retention code for Session A?" (â‰ˆ30 s, real Qwen on EC2 CPU); then the multi-document question "Where are original documents stored, and what is the synthetic retention code for Session A?"; click citations S1/S2; download the original.
9. **Permissions**: sign in as the second user â€” the first user's files, answers and downloads are invisible (404).
10. **Cloud Infrastructure page** (admin): "On the AWS EC2 host Â· Sydney", FREE Â· active guard, CloudWatch evidence; optional single approved S3 Vectors fixture query.
11. **Architecture & cost**: use the diagram in `AWS_FINAL_DEPLOYMENT_REPORT.md` Â§3; â‰ˆUSD 0.12/h running, â‰ˆUSD 2.88/month stopped, â‚¹0 out-of-pocket, no paid plan.
12. **Stop** by double-clicking **Stop NimbusVault AWS.bat**. Wait for actual EC2 `stopped` verification. Use **NimbusVault Status.bat** to display the stopped state; stopping retains the encrypted disk and its storage consumption.

## B. No-new-cloud-writes alternative
Steps 1â€“4 and 7â€“12 using the three already-uploaded synthetic files (canary, Session A note, Borealis memo shared/revoked) and the recorded evidence: `AWS_LIVE_END_TO_END_VERIFICATION.md` (native workflow timeline), `EC2_SEARCH_BENCHMARK.md` (84 queries), `EC2_AI_QUALITY_EVALUATION.md` (40/40), screenshots in `.runtime/aws-deployment/screenshots/ec2-*.png`. Cloud writes stay off.

## C. Offline fallback
If AWS access is unavailable, double-click **Start NimbusVault.bat**, wait for automatic health checks and AI warmup, and demonstrate the Windows standalone app at `http://127.0.0.1:3100`. Finish with **Stop NimbusVault.bat** and present the EC2 evidence documents.

## D. Local one-click procedure

1. Double-click **Start NimbusVault.bat**. Docker Desktop starts automatically if needed; an initial Docker/WSL installation or licensing prompt must be completed normally.
2. Wait for green **SUCCESS** and the default browser to open. Sign in normally; no credentials are embedded in a launcher.
3. Demonstrate files, search, real Qwen answers and citations using existing authorized documents. Local startup does not authorize new AWS writes or a native workflow replay.
4. Double-click **Stop NimbusVault.bat**. Backend and intelligence drain, model allocations unload, and the isolated database stops without volume deletion.
5. Double-click **NimbusVault Status.bat** when you need to show readiness or stopped state. A last warmup timestamp is historical; current MiniLM/model-loaded fields show live readiness when available.

Repeated Start verifies/warms the current services; repeated Stop is harmless. Launcher windows remain open so failures can be read. They require no administrator elevation. Other Docker projects remain running. All existing npm scripts remain supported for advanced use.
