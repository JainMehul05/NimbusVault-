# University demonstration guide — NimbusVault on AWS

Budget ≈30–40 min of instance time (≈USD 0.08 of credits). Needs a fresh session approval (see `AWS_DEPLOYMENT_GUIDE.md`).

## A. Live demonstration
1. **Start** `npm run aws:start` (40 s). Explain the guard: identity, FREE/ACTIVE plan, credit reserve, approval window, independent stop schedule.
2. **Connect** `npm run aws:connect`, then `npm run aws:warmup` (20 s). Explain: private SSM tunnel, no open ports, not a public site.
3. **Open** `http://127.0.0.1:3200`, sign in (synthetic admin account from the private state file).
4. **Dashboard / files**: folders, rename, move, share, trash/restore.
5. **Upload** an approved synthetic document *(requires writes enabled + approval of the S3 write)*.
6. **Native AWS processing** *(only within an approved window)*: explain S3 → EventBridge → SQS → Lambda → Step Functions → DynamoDB; show the Step Functions execution and DynamoDB job in the console; CloudWatch logs.
7. **Search**: paraphrase "which service keeps the uploaded originals private" (semantic) and "retention code ORCHID-4471" (hybrid/BM25).
8. **Ask**: "What is the synthetic retention code for Session A?" (≈30 s, real Qwen on EC2 CPU); then the multi-document question "Where are original documents stored, and what is the synthetic retention code for Session A?"; click citations S1/S2; download the original.
9. **Permissions**: sign in as the second user — the first user's files, answers and downloads are invisible (404).
10. **Cloud Infrastructure page** (admin): "On the AWS EC2 host · Sydney", FREE · active guard, CloudWatch evidence; optional single approved S3 Vectors fixture query.
11. **Architecture & cost**: use the diagram in `AWS_FINAL_DEPLOYMENT_REPORT.md` §3; ≈USD 0.12/h running, ≈USD 2.88/month stopped, ₹0 out-of-pocket, no paid plan.
12. **Stop** `npm run aws:stop` and show `stopped`.

## B. No-new-cloud-writes alternative
Steps 1–4 and 7–12 using the three already-uploaded synthetic files (canary, Session A note, Borealis memo shared/revoked) and the recorded evidence: `AWS_LIVE_END_TO_END_VERIFICATION.md` (native workflow timeline), `EC2_SEARCH_BENCHMARK.md` (84 queries), `EC2_AI_QUALITY_EVALUATION.md` (40/40), screenshots in `.runtime/aws-deployment/screenshots/ec2-*.png`. Cloud writes stay off.

## C. Offline fallback
If AWS access is unavailable, demonstrate the Windows standalone app (`npm start`, `http://127.0.0.1:3100`) and present the EC2 evidence documents.
