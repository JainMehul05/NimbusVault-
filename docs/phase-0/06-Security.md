# NimbusVault — Security Design Document

| Field | Value |
|---|---|
| Document | Phase 0 · 06 — Security Design (Hardened) |
| Prime directive | Tenant isolation is enforced in depth; no single bug exposes another user's documents |
| Version | 2.0 (Hardened) |

---

## 1. Control Matrix

| Layer | Control | Design Detail |
|---|---|---|
| **Authentication** | JWT access (15 min) + rotating refresh (7 d) | HS256, secret from env store; `jti` denylist in Redis for logout; refresh rotation — reuse of a rotated token revokes the whole family (theft detection) |
| **Passwords** | bcrypt cost ≥ 12 | Never logged; login failures return one generic message (no user-enumeration oracle); password change requires current password and revokes all sessions |
| **Authorization** | Ownership middleware on every resource handler | Handler resolves resource then verifies `ownerId == token.sub` OR a `permissions` row grants sufficient level; default-deny |
| **Transport** | HTTPS/TLS 1.2+ only | ACM cert at ALB; HSTS header; S3 bucket policy denies non-TLS (`aws:SecureTransport` false ⇒ deny) |
| **Cloud IAM** | Least-privilege roles | API server role: `s3:PutObject`/`GetObject`/`AbortMultipartUpload` scoped to the single bucket ARN — no listing beyond need, no console, no delete-bucket; deploy credentials separate; root MFA-locked; budget alarms armed |
| **File access** | Pre-signed URLs | 15-min TTL; PUT constrained by content-type + content-length range; no public ACLs or bucket policies granting anonymous reads, ever |
| **Share links** | Opaque 128-bit CSPRNG tokens | Optional bcrypt-hashed password · absolute expiry · max-download cap · instant revocation · every redemption attempt logged with outcome |
| **API surface** | Rate limiting + strict validation | Login 5/min/IP with lockout · presign 30/min · AI 10/min · share redeem 20/min/token+IP; DTO validation = whitelist + type coercion off (blocks mass assignment) |
| **Injection** | Prisma parameterization by default | Raw SQL forbidden except reviewed `$queryRaw` with tagged templates; lint rule fails CI on `$queryRawUnsafe` |
| **XSS / CSRF / CORS** | SPA hygiene | React auto-escaping; no `dangerouslySetInnerHTML` for user content; access token in memory, refresh in httpOnly SameSite cookie; CORS pinned to app origin; CSP header restricts script/font/frame sources |
| **Secrets** | Environment injection only | `.env*` git-ignored with `.env.example` as the contract; GitHub Actions secrets for CI; production secrets move to AWS Secrets Manager in Phase 3; gitleaks scans every push |
| **Headers** | Baseline hardening | HSTS · X-Content-Type-Options nosniff · X-Frame-Options DENY (except preview route framing our own origin) · Referrer-Policy strict-origin · CSP |
| **Dependencies** | Supply chain | Lockfiles committed; `npm audit`/`pip audit` gate in weekly CI; Renovate-style update PRs reviewed like code |

---

## 2. Authentication Layers

### 2.1 JWT Access Tokens
- **Algorithm:** HS256 (symmetric, secret rotated quarterly)
- **Claims:** `sub` (userId), `jti` (unique token ID), `iat`, `exp` (15 min), `role`, `status`
- **Storage:** Client memory only (never localStorage)
- **Denylist:** Redis set `jwt:denylist:{jti}` with TTL = token remaining lifetime; checked on every authenticated request

### 2.2 Refresh Tokens
- **Format:** Opaque UUID v4 (not JWT)
- **Storage:** HttpOnly, Secure, SameSite=Strict cookie + hashed in DB
- **Rotation:** New token issued on every use; old token marked `revoked_at`
- **Replay Detection:** Reuse of a revoked token → entire token family revoked (theft detection)
- **Family Tracking:** `token_family` UUID groups rotated tokens; enables mass revocation on logout/theft

### 2.3 Session Management
- **User Sessions Table:** Tracks device, IP, created/last-used timestamps
- **Concurrent Session Limit:** Configurable (default 10); oldest revoked when exceeded
- **Password Change:** Revokes ALL sessions + refresh tokens
- **Admin Revocation:** API to revoke all sessions for a user (support use case)
- **Stale Session Cleanup:** Nightly job revokes sessions inactive > 30 days

### 2.4 Password Policy
- **Minimum:** 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
- **Bcrypt Cost:** 12 (adjustable via env, minimum 10)
- **Breach Check:** Optional integration with HaveIBeenPwned API (Phase 3+)
- **History:** Prevent reuse of last 5 passwords (Phase 3+)

---

## 3. Authorization Layers

### 3.1 Layered Isolation (Defense in Depth)

```
Layer 1  Authentication      → no valid JWT, no request past the guard
Layer 2  Ownership check     → handler compares resource.ownerId to token.sub
                                  (or consults permissions table)
Layer 3  Query scoping       → every SQL statement filters by ownerId /
                                  permitted ids; "file not found" and "not
                                  yours" are indistinguishable 404s
Layer 4  S3 key namespace    → keys are users/{ownerId}/… ; even a leaked,
                                  re-signed URL can only address caller-scoped keys
                                  because the API role signs within that prefix
Layer 5  Pre-signed expiry   → any stolen link dies in ≤ 15 minutes
Layer 6  Vector-store filter → ANN queries filter metadata by permitted
                                  fileIds; retrieval physically cannot return
                                  foreign chunks
Layer 7  Audit trail         → activity_logs record every read/mutation with
                                  IP; anomalies are reviewable after the fact
```

### 3.2 Worked Attack Walkthrough

| Attack | Outcome |
|---|---|
| A guesses B's file UUID, calls `GET /files/:id` | Layer 2/3: ownership check fails → generic `404`; nothing revealed |
| A steals B's *pre-signed download URL* from shared network | Layers 4–5: URL works ≤15 min for exactly that object; cannot be escalated to other objects or listings |
| A crafts query `{ fileId: <B's file> }` to `/ai/query` | Layer 6: vector search allow-list excludes B's chunks → refusal path ("not found") |
| A registers token `…/s/x` brute-force to find valid links | Rate limit (20/min/token+IP) + 128-bit token space makes enumeration infeasible (~2¹²⁷ work) |
| Insider runs raw SQL `SELECT * FROM files` | Layer 3 is app-level, but DB role used by app has least privilege; production DB not internet-exposed; activity logs + migration reviews deter and detect |

### 3.3 Permission Model

| Resource | Owner | Permissions Table | Share Link |
|---|---|---|---|
| **File** | Full control | VIEWER (read/preview/search) · EDITOR (+rename/move/delete) | VIEW (preview only) / DOWNLOAD |
| **Folder** | Full control | VIEWER (read/browse) · EDITOR (+rename/move/delete children) | N/A |
| **Share Link** | Creator only | N/A | VIEW / DOWNLOAD + optional password/expiry/cap |

**Effective Access = Owner OR Permission Row Exists with Sufficient Level**
- Folder grants cascade read down the subtree (walk bounded by depth cap)
- Share links are independent of permissions table

---

## 4. Application Security

### 4.1 Input Validation
- **Zod schemas** on every public endpoint — validated before handler executes
- **Whitelist approach** — only declared fields accepted; extra fields stripped
- **Type coercion off** — blocks mass assignment attacks
- **File upload constraints** enforced at presign: content-type, content-length range, magic bytes verified at finalize

### 4.2 Output Encoding
- React auto-escaping by default
- No `dangerouslySetInnerHTML` for user content
- PDF/text previews served via sandboxed iframe or object URL with CSP

### 4.3 Transport Security
- **HTTPS Only:** ACM cert at ALB; HSTS header (`max-age=31536000; includeSubDomains; preload`)
- **S3 TLS Enforcement:** Bucket policy denies non-TLS (`aws:SecureTransport` false ⇒ deny)
- **CORS:** Pinned to exact app origin(s); no wildcard

### 4.4 Headers (Helmet.js)
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.s3.amazonaws.com; frame-ancestors 'self';
X-Content-Type-Options: nosniff
X-Frame-Options: DENY (preview route: SAMEORIGIN)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### 4.5 Rate Limiting
| Endpoint Class | Limit | Implementation |
|---|---|---|
| `POST /auth/login` | 5/min per IP + exponential lockout | Redis counter + lockout key |
| `POST /auth/register` | 3/min per IP | Redis counter |
| File/folder CRUD | 60/min per user | Redis sliding window |
| `POST /files/upload-url` | 30/min per user | Redis sliding window |
| AI endpoints | 10/min per user | Redis sliding window |
| Public share redemption | 20/min per token+IP | Redis sliding window |

---

## 5. Cloud & Infrastructure Security

### 5.1 AWS IAM (Least Privilege)

| Role | Permissions |
|---|---|
| **API Server** | `s3:PutObject`, `s3:GetObject`, `s3:AbortMultipartUpload` on `arn:aws:s3:::nimbusvault-files/*` + `s3:ListBucket` for prefix `users/${ownerId}/*` |
| **AI Worker** | `s3:GetObject` on `arn:aws:s3:::nimbusvault-files/users/*` |
| **Deploy (CI)** | `ecr:PutImage`, `ecs:UpdateService`, `ssm:GetParameters` (scoped) |
| **Backup/Restore** | `rds:DescribeDBInstances`, `rds:RestoreDBInstanceFromDBSnapshot`, `s3:GetObject` on backup bucket |

- **Root Account:** MFA-locked, no access keys
- **Budget Alarms:** $35/$40 warnings; auto-shutdown at $45
- **VPC:** Private subnets for DB/Redis; ALB in public subnets; NAT Gateway for egress

### 5.2 S3 Bucket Hardening
- **Versioning:** Enabled (ransomware/accidental-delete recovery)
- **Encryption:** SSE-S3 (AES-256) mandatory; bucket key enabled
- **Public Access:** Blocked at bucket level (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`)
- **Lifecycle:** Incomplete multipart uploads aborted at 7 days; trash objects expire at 30 days
- **CORS:** Pinned to app origin; allowed methods: GET, PUT, HEAD; max age 1 hour

### 5.3 Network
- **VPC:** 2 AZs; private subnets for DB/Redis; public subnets for ALB
- **Security Groups:** ALB → API (port 3000); API → DB (5432), Redis (6379), S3 (VPC endpoint)
- **No Internet Access** for DB/Redis/AI worker; NAT Gateway for outbound (PyPI, LLM API)

---

## 6. AI-Specific Security

### 6.1 Retrieval Scoping
- Embeddings store `{userId, fileId}` metadata
- Every ANN query passes the caller's permitted-ID set as a **mandatory filter**
- The RAG prompt builder receives only post-filter chunks

### 6.2 Prompt-Injection Containment
- Document text is untrusted input — fenced as quoted context
- System instructions forbid obeying instructions found inside documents
- Assistant has no tool/action capabilities (it can answer, nothing else)
- Worst case of successful injection = wrong answer with citations, not data exfiltration

### 6.3 Provider Calls
- LLM calls carry question + retrieved chunks only — never credentials, never other tenants' content
- Request/response logged (redacted) for audit

### 6.4 Cost Abuse Control
- Per-user AI rate limit (10/min) + monthly token budget alarm
- Circuit breaker on LLM provider failures (fail fast, return cached/refusal response)

---

## 7. Threat Model Summary (STRIDE-lite)

| Threat | Vector | Countermeasure |
|---|---|---|
| **Spoofing** | Stolen/guessed tokens | Short JWT TTL, rotation + reuse detection, rate-limited login |
| **Tampering** | MITM, object tampering | TLS everywhere, S3 versioning, SHA-256 checksum verification at finalize |
| **Repudiation** | "I never shared/deleted that" | Append-only activity_logs incl. share redemptions |
| **Information Disclosure** | Cross-tenant reads, link leakage | §2 layer stack, opaque expiring tokens, private buckets |
| **Denial of Service** | Flooded endpoints, huge uploads | Rate limits, size caps at presign, queue buffering absorbs AI bursts, ALB + autoscaling |
| **Elevation of Privilege** | Parameter tampering (`ownerId` in body), IDOR | Whitelist DTO validation strips undeclared fields; ownership middleware; permission tests in CI |

---

## 8. Incident Response

### 8.1 Detection
- **Anomaly Alerts:** Failed login spike, token reuse detection, quota exhaustion, AI cost spike
- **Log Correlation:** Request ID ties API logs to activity logs to queue logs
- **SIEM:** CloudWatch Logs → OpenSearch (Phase 3+)

### 8.2 Response Playbooks

| Incident | Immediate Action | Investigation |
|---|---|---|
| Token reuse detected | Revoke token family; force re-login | Check IP/device; notify user |
| Share link brute force | Rate limit triggered; block IP | Review redemption logs |
| Cross-tenant access attempt | Alert on `404` spike from single user | Verify isolation layers |
| AI cost spike | Circuit breaker triggers; alert | Check token usage; cap if needed |

### 8.3 Forensics
- Activity logs retain 12 months with IP, user agent, request ID
- Request ID correlation across API, queue, AI service
- S3 access logs for byte-level audit

---

## 9. Compliance Considerations

- **Data Residency:** Single region (us-east-1); multi-region via bucket replication (Phase 3+)
- **Encryption:** At rest (S3 SSE-S3, RDS encrypted); in transit (TLS 1.2+)
- **Access Logs:** CloudTrail + ALB access logs → S3 (immutable)
- **Deletion:** Soft delete → purge after 30 days; account deletion anonymizes PII but retains audit logs
- **Third Party:** LLM provider (OpenAI) — DPA signed; data not used for training

---

## 10. Security Testing Gates (CI)

| Check | Tool | Gate |
|---|---|---|
| Dependency vulnerabilities | `npm audit` / `pip audit` | Fail on high/critical |
| Secret scanning | `gitleaks` | Every push |
| SAST | `eslint` + custom rules / `ruff` | Every PR |
| Container scan | `trivy` | On image build |
| IAM policy lint | `cfn-lint` / `checkov` | On infra changes |
| Penetration test | Annual (external) | Pre-release |

---

*Security is not a feature — it's the architecture.*