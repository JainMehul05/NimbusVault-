# Security

## Controls

| Area | Control |
|---|---|
| Passwords | bcrypt 12, 72-byte limit enforced, constant-work response for unknown accounts |
| Sessions | HttpOnly, Secure, SameSite=Strict cookie limited to the auth path; access token in memory; rotation with reuse detection; server-side revocation checked on every request; 30-day absolute limit |
| CSRF | Custom header plus Origin check on cookie-authenticated calls; everything else uses a bearer token |
| Brute force | Per-IP, per-account and per-account-per-IP limits; share links 20 requests per 15 min per IP |
| Authorization | Deny by default, server-side, 404 for invisible items; matrix tested for stranger, Viewer, Editor and Owner |
| Uploads | Type allow-list, executable and HTML sniffing, random keys, exact signed length and type, verified before becoming visible |
| Downloads | 5-minute URLs, forced attachment, SVG served as opaque binary |
| Share links | 256-bit tokens stored hashed, optional bcrypt password, atomic limits, tied to their creator's current access, never cached |
| Injection | Parameterised SQL (Prisma), LIKE wildcards escaped, names restricted, no `dangerouslySetInnerHTML` |
| AI | Permissions inside vector search, re-checked before and after generation; documents are delimited data; unsupported citations stripped; errors never carry document text; no redirects followed with data attached |
| Parsing | PDF scripting off; DOCX expansion measured under a cap; page, size and character limits; crashing documents are abandoned |
| Logs | No passwords, tokens, share tokens, query strings or document text |
| Configuration | Production refuses to start with weak, placeholder or identical secrets, http origins, or unsafe cookies |

## Audit of this release

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | Presigned uploads needed no quota and no record: unlimited free storage | Fixed |
| 2 | High | Access and refresh tokens in `localStorage` | Fixed |
| 3 | High | Refresh rotation not atomic: one token could yield two sessions | Fixed |
| 4 | High | Access tokens stayed valid after sign-out | Fixed |
| 5 | High | Links created by an editor survived that editor's removal | Fixed |
| 6 | High | Test suite wiped the development database | Fixed |
| 7 | High | Vulnerable dependencies (30 advisories, 4 critical) | Fixed; see below |
| 8 | Medium | Share-link tokens written to request logs | Fixed |
| 9 | Medium | Presigned downloads valid an hour, inline, with an attacker-chosen type | Fixed |
| 10 | Medium | Guessable storage keys (`Math.random`) | Fixed |
| 11 | Medium | `req.ip` was the proxy behind a load balancer, defeating rate limits | Fixed |
| 12 | Medium | Zip bombs; poison documents retried forever | Fixed |
| 13 | Medium | Concurrent folder moves could create a cycle; duplicate names by race | Fixed |
| 14 | Medium | `10.evil.com` treated as a local AI endpoint, hiding the privacy notice | Fixed |
| 15 | Low | Account enumeration by timing; case-sensitive e-mails; log injection by request id | Fixed |
| 16 | Low | Deleted files were never removed from storage | Fixed |

## Accepted residual risks

- A presigned URL keeps working for up to 5 minutes after access is revoked.
- Share-link tokens are part of the URL (browser history, and proxies you operate); edge access logs are therefore off.
- Rate limits are per process.
- Registration reveals whether an e-mail is taken, as does sharing with someone's address.
- No e-mail verification, password reset or multi-factor sign-in yet.
- The application uses the database owner role on AWS.
- `style-src 'unsafe-inline'` is needed by inline style attributes.
- Uploaded files are not virus-scanned.
- Indexing runs untrusted documents through pdf.js, mammoth and tesseract in the worker process, not a separate sandbox.

Report vulnerabilities privately to the repository owner.
