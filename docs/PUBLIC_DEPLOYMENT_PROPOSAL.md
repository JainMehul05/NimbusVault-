# Session B proposal — startup repair + AWS-native public HTTPS (NOT yet authorized)

27 Nov 2026. Investigation was read-only; no AWS resource has changed since Session A. Revised for your requirement: **AWS-generated URL only** (`https://<id>.cloudfront.net`), no third-party hostnames.

## 1. Current state (read-only, 10:58 UTC)
EC2 `i-0569d222e63fc7f36` **stopped** (user-initiated 10:47:15). FREE/ACTIVE, USD 139.997804, expiry 2027-05-24. Rule DISABLED, mapping Disabled. Session A approval expired 13:25:30 UTC (its stop schedule fires harmlessly then). Git `a37cd5b`; `reports/` untouched.

## 2. Startup failure — diagnosis and repair
**Cause (strongly supported):** `aws:start` launched the instance at 10:46:43; SSM reported Online and the health command ran **21 s after start**, while the OS was still booting (31 s measured) and Docker was restarting containers. Docker's port proxy accepts the TCP connection on 127.0.0.1:3100 before Express is listening, then **resets** it → curl **exit 56**. `--retry-connrefused` only retries *refused* connections, so none of the 20 retries happened. The script then stopped the instance — correct fail-safe. Session A's start test passed only because SSM came online later (a race). To confirm in-session: persistent journal of that boot (`journalctl -b -1`).
**Repair:** host `deployment/ec2-ready.sh` — bounded (≤360 s) loop that waits for `nimbusvault.service` (`compose up --wait` = all health checks) and validates real responses: `/api/v1/health` JSON (`status=ok`, `host=ec2`), intelligence `/health`, `pg_isready`, Ollama, and finally the **public CloudFront URL** from the laptop with certificate verification. All transient errors (refused/reset/timeout/5xx) retried; labelled stages. `scripts/aws-runtime.py`: consistent SSM/waiter/local deadlines (~420 s); on failure collects sanitized diagnostics *before* stopping; distinct messages for AWS auth, expired authorization, plan/credit guard, EC2, SSM, DB, backend, intelligence, CloudFront, TLS. A delayed-readiness test reproduces the reset.

**Session workflow (no JSON editing):** `npm run aws:start -- --hours 2` (max 4) shows runtime, estimated credits, live plan/credits/expiry → you type **YES** → new authorization, absolute deadline written to instance tag `NimbusStopDeadline`, credit baseline tag, old/completed stop schedule deleted and a fresh one created (`ActionAfterCompletion=DELETE`), instance started (never created), readiness waited, **public URL printed**. Host watchdog reads deadline/credits from the instance tags, so restarts cannot extend a session; missing/past deadline → poweroff within 10 min. New `aws:url`, `aws:doctor`; `aws:connect` becomes admin-only.

## 3. AWS-native public endpoint — eligibility and design
Free plan "included services" list (official, read today): **Amazon CloudFront** (note: Lambda@Edge not supported — not used), Amazon API Gateway, AWS Cloud Map, Route 53, ACM (exportable certs not supported). "Multi-Region features not supported" — none used. **CloudFront flat-rate plans (Free/Pro/…) are a separate optional pricing choice; I will not select one** — the distribution stays pay-as-you-go, covered by CloudFront's always-free usage (1 TB out, 10 M requests/month) and otherwise by credits. Default `*.cloudfront.net` domain uses CloudFront's own trusted certificate.

**Key constraint:** CloudFront VPC origins are documented for "EC2 instances in private subnets". Our instance is in the default *public* subnet. A truly private subnet would need a NAT gateway or paid interface endpoints, and the Free-plan API (watchdog/guard) has no VPC endpoint — so moving the instance is rejected. The docs do not say a public-subnet instance is refused, so the plan tries the best option first and falls back, with no cost for a refused API call:

| Order | Path | Origin privacy & encryption | Restart behaviour | Limits |
|---|---|---|---|---|
| **A (try first)** | CloudFront → **VPC origin** (instance ARN) → EC2 private IP:8080 | No public inbound; SG allows only `CloudFront-VPCOrigins-Service-SG`; traffic stays inside AWS VPC (HTTP inside VPC) | Private IP unchanged on stop/start → **no per-start changes** | Origin timeout ≤120 s |
| **B (if A refused)** | CloudFront → **API Gateway HTTP API** (AWS TLS) → **VPC link** → Cloud Map → EC2 private IP:8080 | No public inbound; CF→API Gateway encrypted; private VPC hop | No per-start changes | 30 s integration timeout, 10 MB payload; Cloud Map USD 0.10/month |
| C (only with your OK) | CloudFront → EC2 public DNS:8080 restricted to CloudFront origin-facing prefix list | Edge→EC2 leg **unencrypted HTTP over public network** (no trusted cert possible without a domain) | Origin updated at each start (few minutes) | ≤120 s |
ALB/NLB (≈USD 16+/month), NAT, Elastic IP, Route 53 domain purchase are excluded.

**Origin protection (all paths):** CloudFront adds a secret header (random, stored only in the distribution and host env); Express rejects public-port requests without it; SG limited to the CloudFront/VPC-link source; ports 5432/8101/11434/3100/22 stay closed; IMDSv2 unchanged; new public port bound to the private IP only.
**CloudFront configuration:** HTTPS only (HTTP → redirect, so no HTTP login page), TLS 1.2+, methods GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE; default behaviour **CachingDisabled** + `AllViewerExceptHostHeader` (all cookies, query strings, Authorization and other headers forwarded; nothing personal cached); only `/assets/*` (hashed, public static JS/CSS) cached; security-headers response policy (HSTS etc.); origin response timeout 120 s, keep-alive 5 s. Pay-as-you-go, no WAF (paid), no logs to S3 (avoids storage cost).
**App config:** `FRONTEND_URL` = the CloudFront URL (+ private 127.0.0.1:3200), `COOKIE_SECURE=true`, existing EC2 cookie name, exact-origin CORS/CSRF, `TRUST_PROXY` = VPC CIDR so rate limits use the real viewer IP (spoofed `X-Forwarded-For` ignored). Downloads continue to use short-lived S3 presigned URLs (browser→S3 directly, HTTPS).

## 4. Asynchronous AI (required by every AWS path)
Answers are one non-streamed request; measured cold 71 s, long summary 109 s, configured worst case ~4.5 min — over CloudFront's 120 s and API Gateway's 30 s. Implement `POST /ai/ask/async` → `202 {jobId}` and `GET /ai/ask/async/:jobId` (owner-checked, polled by the frontend every 2 s, 15-min TTL), reusing the existing ask logic, permissions, citations, cancellation (`requestId`) and history. Sync endpoint kept for Windows/tests. Every request then completes in seconds, so no valid inference is terminated. Backend + frontend tests added.

## 5. Public abuse controls (before exposure)
Registration mode switch; global account cap; per-user quota **20 MB** (today 5 GiB) and **25 files**; global storage cap 500 MB; max file 5 MB; types txt/md/pdf/docx; AI 10 per 10 min and 40/day per user; one generation globally (409); search 60/10 min; registration 5/hour/IP; auth failure limits (existing); body 6 MB; admin endpoints admin-only. OCR and permanent purge stay off. EventBridge stays disabled, so public uploads never reach Lambda extraction.

## 6. Residual vulnerabilities (fresh rescan, DB 2026-11-27 01:08 UTC)
Same 23 identifiers as Session A; only CVE-2026-78661 (x/net in vendor Ollama, internal-only) has an upstream fix (needs a new Ollama release). libxml2 (scanner-critical) is in PostgreSQL only and reachable solely via fixed Prisma queries; uploaded documents are parsed in the intelligence image, which has no libxml2 or Python-package HIGH findings. Public TLS terminates at CloudFront. No materially exploitable public path found; still a **synthetic-data demonstration, not production-certified**. Rescan again before opening.

## 7. AWS changes requested
**Create:** 1 CloudFront distribution (pay-as-you-go, no flat-rate plan); 1 CloudFront VPC origin (path A) — *or* (path B) 1 HTTP API + 1 VPC link + 1 Cloud Map namespace/service/instance; 1 response-headers policy if needed. **Modify:** SG `sg-0fce31aed9cee47dc` (+ inbound 8080 from the CloudFront VPC-origin SG or VPC-link SG only); instance tags; stop schedule replaced per session. **Synthetic writes:** ≤5 new synthetic originals (≤1 MiB), one native workflow window ≤15 min from the public site with independent restore schedules, ≤3 S3 Vectors queries. **Preserve:** stack, queues, DLQ, vectors, 19 objects, EC2 data. **Not created:** new instance, EIP, NAT, LB, domain, third-party accounts.

## 8. Testing in the session
≥3 ordinary `aws:start` cycles + delayed-readiness reproduction; CloudFront certificate/headers/no-cache checks; 54 responsive + 7 workflows on the CloudFront URL (no SSM); console/mixed-content/CORS/cookie checks; full feature set; two-user isolation; bounded CSRF/XSS/SQLi/path-traversal/SSRF/unsafe-upload/rate-limit/prompt-injection probes; direct-origin bypass refused; cold and long Qwen answers through CloudFront; native workflow from the public site with SHA-256 match; **you open the URL on phone mobile data** (external network); external Scheduler stop of a running instance and watchdog emergency poweroff (root-only fault-injection file); search 84 on EC2; Qwen 40 rerun (request path changes); Windows `npm start` with real Qwen incl. the 2 skipped tests.

## 9. Runtime and credits (live prices: USD 0.1197/h compute, 0.005/h IPv4, 0.096/GiB-month gp3)
1 h 0.12 · 4 h 0.50 · 8 h 1.00 · 24 h 2.99 · 30 days continuous ≈ 92.7 (incl. EBS) · stopped 2.88/month · CloudFront within always-free usage ≈ 0 · Cloud Map (path B) 0.10/month. Through 24 May 2027: EBS ≈ 17, leaving ≈ 120 credits ≈ 960 running hours (≈ 5 h/day) — on-demand demo windows, never always-on without approval.
**Session B request: ≤4 h EC2 runtime, ≤USD 10 credits, ≥USD 10 reserve (expected ≈ USD 0.6–1.0).** ₹0 out-of-pocket; plan never upgraded; caps are operational (billing lag).
While stopped, the CloudFront URL stays the same but returns an error page; it serves the app again after the next authorized `aws:start`.

## 10. Rollback
Disable/delete the distribution (or remove the 8080 SG rule) → public access gone immediately; app reverts to private mode by env; VPC origin / API Gateway resources deleted; data untouched; previous images kept.

## 11. Decisions needed
1. Approve Session B as above (A → B fallback; C not without asking).
2. Visitor access policy: (a) invite-code registration + 2 demo accounts (recommended); (b) open registration with strict quotas and a global cap (e.g. 50 accounts); (c) demo accounts only.
