## External AI (Groq) — Session C
Groq receives only the question and authorized excerpts of files whose owner and asker both opted in (default off; shared readers cannot release an owner's file). Fixed endpoint `https://api.groq.com/openai/v1`, TLS verified, no redirects, no tools/browsing/file uploads. Key: SecureString parameter → 0400 file mounted only in the intelligence container; not in env, logs, responses or Git (scanned). Quotas persisted and reserved before each request; 401/403 lockout, 429 cooldown. Residual: Groq is an external processor in the US (no retention by default per Groq docs; enable ZDR in the console); the 23 container CVE identifiers remain unchanged.

---

## Public exposure controls (Session B, 27 Nov 2026)
Public entry: API Gateway (AWS TLS) → VPC link → EC2 private IP:8080. **No inbound internet port on EC2** (8080 admitted only from the VPC-link SG and the CloudFront VPC-origin SG); 8080/3100/80/443/22 verified refused from the internet. The 8080 listener rejects requests lacking the secret origin header (origin-guard stage: 403). The client IP travels in a gateway-set header trusted only together with the secret (API Gateway reserves `X-Forwarded-For`). Invite-code registration (constant-time comparison, fails closed), 50-account cap, 20 MB / 25 files per user, 500 MB global, 5 MB files, txt/md/pdf/docx only, AI 10 per 10 min and 40/day, one generation at a time, registration 5/h per IP, gateway 20 rps. Secure HttpOnly EC2 cookie, CSRF (Origin + X-Requested-With), exact-origin CORS, HSTS/CSP/nosniff/frame headers. Probes passed: SQL injection in search, path traversal, `alg:none` JWT, unsupported and oversize uploads (rejected before storage), foreign-origin CORS, prompt injection, cross-user files/folders/downloads/conversations/async jobs, admin endpoints. Residual: the 23 upstream CVE identifiers below (rescanned, unchanged); plain HTTP between API Gateway and EC2 inside the VPC; SSM command history (visible to account administrators) contains the base64 origin secret and invite codes.

---

# Deployment security assessment — preparation only

27 November 2026. No EC2 host is deployed. This assessment separates image scanning, local enforcement and cloud controls still awaiting live verification.

## Image scanning and changes

The verified free Trivy 0.76.2 executable scanned the actual Docker images using its vulnerability database. Raw JSON reports, logs, image IDs and previous findings are retained privately. No paid security product was enabled. Counts are package findings, not unique vulnerabilities; absence from a scan is not proof of safety.

The initial Bookworm intelligence image reported two critical findings (SQLite CVE-2025-7458 and zlib CVE-2023-45853), plus high OS and Python tooling findings. Production bases were changed to pinned Debian Trixie images. Application dependency versions remain locked. pip/ensurepip and npm are build tooling and were removed from the final Python/Node runtime images; migration executes the locked Prisma CLI with Node directly. Available stable OS security updates were applied, including libzstd's available fix.

Updated scan snapshots:

| Runtime | Critical | High | Notes |
|---|---:|---:|---|
| API | 0 | 52 | OS findings; no high Node-package findings |
| Intelligence | 0 | 53 | OS findings; no high Python-package findings |
| CPU Ollama (`421145…`, bundled release image) | 0 | 54 | OS plus one bundled Go x/net finding (fixed upstream in x/net 0.62.0, requires a new vendor Ollama release) |
| PostgreSQL | 1 | 72 | Stable updates applied; root-only gosu removed; residual libxml2 has no stable vendor fix |

### Exact unique HIGH/CRITICAL identifiers (Claude review of the final scans, 27 Nov 2026)

23 unique identifiers stand behind the 231 package findings. None of the 22 Debian identifiers has a stable Trixie fix available (`affected` or `fix_deferred`), so rebuilding cannot remove them today.

| Identifier | Package | Images | Exposure in this deployment |
|---|---|---|---|
| CVE-2026-6653 (scanner CRITICAL, Debian minor/no-dsa), CVE-2026-74860, -86138, -86139, -86140, -86142, -86143, -86144 | libxml2 | postgres | PostgreSQL XML functions are reachable only through SQL. The application issues fixed Prisma queries and has no XML/SQL input surface. The DB is on an internal network with no published port |
| CVE-2026-107494, CVE-2026-124709 | OpenSSL libssl3 | all | No TLS server in any container. Outbound TLS goes only to AWS endpoints (intelligence/host). This is the most relevant residual risk. Rebuild when Debian ships fixes |
| CVE-2026-119373, -119374, -119379 | libsqlite3 | all | Needs attacker-controlled SQL/FTS schema. The application uses fixed statements |
| CVE-2026-76642, -78408, -78409, -78410 | util-linux family | all | Needs mount/namespace privileges. Containers run non-root with all capabilities dropped and no-new-privileges |
| CVE-2026-16742 | libsystemd/libudev | all | systemd does not run inside the containers |
| CVE-2026-54369 | libacl1 | all | No ACL manipulation by application users |
| CVE-2025-69720 | ncurses | all | No terminal input surface |
| CVE-2026-24882 | gnupg | postgres | Not invoked at runtime |
| CVE-2026-9538 (fix_deferred) | perl | all | No user-controlled Perl execution |
| CVE-2026-78661 | golang.org/x/net 0.61.0 in the Ollama binary | ollama | HTML parsing in vendor code. Ollama is reachable only from the internal `models` network, and web search/cloud features are disabled |

**Deployment appropriateness:** these findings are acceptable for a bounded, private, synthetic-data university demonstration with no inbound ports. They are not acceptable for unrestricted production. None is marked fixed.

The database scan exposed CVE-2026-6653 in stable libxml2. Debian lists stable Trixie as vulnerable, with no stable fix, classifying it `no-dsa`/minor; the scanner labels it critical. Preserve both assessments. The application exposes no SQL/XML query interface, the database has no published port, and only authenticated application containers access it. This limits exposure but does **not** make the package fixed. Do not describe the whole deployment as having zero critical findings unless a subsequent actual scan supports that claim.

Many util-linux findings require a privileged operator, namespace operations or mount utilities; production containers are non-root, drop all capabilities and have no Docker socket. SQLite FTS5 CVE-2026-119373 requires attacker-controlled SQL/FTS table construction, which the application does not expose. These are exposure assessments, not suppressed scanner results. Ollama's bundled x/net HTML parser finding remains in the vendor binary; the application uses local generation only, the model network is internal, cloud access is disabled, and web-search endpoints are not application features.

Residual known findings must accompany the consolidated approval proposal. There is no unrestricted production-security certification.

## Locally verified controls

- Separate Linux test secrets, users, PostgreSQL and SQLite; no Windows private document/history database copied.
- Non-root container users, read-only root filesystem, bounded tmpfs/logs/memory, dropped capabilities and no-new-privileges.
- Only Express publishes a loopback port; PostgreSQL, FastAPI and Ollama have no host ports.
- Private service token restricted to trusted loopback/container intelligence addresses; regression rejects arbitrary configured external hosts.
- Real login, wrong-password rejection and cross-account history/download denial; cloud refresh cookie cannot overwrite the Windows cookie.
- Synthetic multi-document scope enforcement and citation display.
- Account identity pin, FREE/ACTIVE plan, expiration, USD unit and USD10 EC2 reserve guard; unknown state fails closed.
- Real SDK event instrumentation for S3 Vectors; isolated benchmarks install an SDK tripwire, count attempts and prevent live SDK requests.
- IAM simulation verifies upgrade/provision/delete/overwrite denies. This is not a substitute for verifying actual instance-role credentials.

## Controls requiring post-approval EC2 evidence

No inbound security-group rules; mandatory IMDSv2; metadata firewall allowing only the intelligence egress bridge; private SSM access; encrypted EBS; instance-role plan API permissions; no personal credential files; boot stop timer; independent deadline schedule; idle-restoration schedules; clean active shutdown and actual stopped state.

The app role cannot modify event routing or consumers. A separate scoped Scheduler role is proposed only for stopping the exact tagged instance and restoring the exact existing rule/consumer to idle. Drafts intentionally contain an instance/deadline placeholder and cannot run before approval. User approval must explicitly include these helper resources.

Original data deletion, account-plan upgrades, arbitrary provisioning, public HTTP/SSH access, vector uploads and DLQ receive/replay are outside the proposed scope.

## Primary references

[SQLite critical fix status](https://security-tracker.debian.org/tracker/CVE-2025-7458), [zlib status](https://security-tracker.debian.org/tracker/CVE-2023-45853), [libzstd stable fix](https://security-tracker.debian.org/tracker/CVE-2026-124851), [libxml2 residual finding](https://security-tracker.debian.org/tracker/CVE-2026-6653), [SQLite FTS5 residual finding](https://security-tracker.debian.org/tracker/CVE-2026-119373), [util-linux prerequisite](https://security-tracker.debian.org/tracker/CVE-2026-78408), [IMDSv2 configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).
