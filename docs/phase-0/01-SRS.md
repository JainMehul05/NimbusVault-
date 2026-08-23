# NimbusVault — Software Requirement Specification (SRS)

| Field | Value |
|---|---|
| Document | Phase 0 · 01 — Software Requirement Specification |
| Standard | Adapted IEEE 830 style, requirement IDs are testable |
| Version | 1.0 |
| Status | Approved baseline for Phase 1 |

---

## 1. Project Overview

### 1.1 Problem

Individuals and small teams keep their documents scattered across devices, email threads and chat apps. This creates four recurring failures: **data loss** when a device dies, **wasted time** hunting for files whose names nobody remembers, **unsafe sharing** (uncontrolled attachment copies), and **zero understanding** — storage systems treat documents as opaque bytes, so no one can *ask questions* of their own library.

### 1.2 Solution

NimbusVault is a cloud-native storage platform that separates durable file storage (AWS S3) from searchable metadata (PostgreSQL), exposes both through a clean REST API, and layers document intelligence on top: text extraction, semantic embeddings, vector search and a Retrieval-Augmented Generation (RAG) assistant that answers questions with citations.

### 1.3 Target Users

| Segment | Pain | NimbusVault answer |
|---|---|---|
| Students | Notes lost across devices; can't find "that slide" before exams | One browser library + semantic search ("find notes about BCNF") |
| Developers | Need durable storage + predictable APIs to build on | REST contract v1, pre-signed transfers, documented architecture |
| Individuals | Device storage full; device loss = data loss; risky public links | S3 durability, recoverable trash, expiring password-protected links |
| Small teams | Attachment version chaos; all-or-nothing drive access | Per-resource permissions, audit log, AI grounded in team documents |

### 1.4 Project Goals

- **G1** Separate file objects (S3) from metadata (PostgreSQL) as independently scalable planes.
- **G2** Route all byte traffic browser ↔ S3 via pre-signed URLs; API servers never stream payloads.
- **G3** Deliver meaning-based search and cited RAG answers over user documents.
- **G4** Practice production engineering: contracts, migrations, CI/CD, containers, review, monitoring.
- **G5** Enforce least-privilege security end-to-end; tenant isolation is provable, not incidental.
- **G6** Keep every service stateless so scaling means adding replicas.

### 1.5 Out of Scope (v1 non-goals)

Real-time collaborative editing · version history/rollback · desktop sync clients · mobile apps · billing/payments · org-level admin console.

### 1.6 Assumptions & Constraints

- Single AWS account, student budget ≈ $40/month (see Technology doc §9).
- Max upload size 100 MB (Phase 1); per-user quota default 5 GB.
- Team of 4; timeline 16 weeks; English UI.

---

## 2. Functional Requirements

IDs follow `FR-<MODULE>-<NN>`. Every ID is verifiable by test or demo.

### Module A — Authentication (`AUTH`)

| ID | Requirement |
|---|---|
| FR-AUTH-01 | Register with name, email, password (≥8 chars); duplicate emails rejected case-insensitively. |
| FR-AUTH-02 | Passwords hashed with bcrypt (cost ≥ 10); plaintext never stored or logged. |
| FR-AUTH-03 | Login issues access JWT (~15 min) + refresh token (~7 days) with rotation. |
| FR-AUTH-04 | Logout denylists the access token's JTI until natural expiry and revokes the refresh family. |
| FR-AUTH-05 | `GET /auth/me` returns profile including quota usage. |
| FR-AUTH-06 | Profile management: user may update display name; change password after re-authentication; changing password revokes all sessions. |
| FR-AUTH-07 | Protected endpoints return `401` (no/invalid token) or `403` (authenticated but unauthorized). |

**Input → Processing → Output**

- **Register** — *In:* `{name(1–80), email, password(≥8)}` · *Proc:* validate → uniqueness check → bcrypt hash → transactional insert · *Out:* `201` user record (never the hash) + tokens.
- **Login** — *In:* `{email, password}` · *Proc:* fetch user → constant-time bcrypt compare → sign JWT (`sub`, `jti`, `iat`, `exp`) · *Out:* `200 {accessToken, refreshToken, expiresIn}`; generic `401` on any failure (no enumeration oracle).
- **Logout** — *In:* Bearer token · *Proc:* JTI denylist until `exp` · *Out:* `204`.
- **Profile update / password change** — *In:* `{name?}` / `{currentPassword, newPassword}` · *Proc:* verify session & current password → hash new → invalidate other sessions · *Out:* `200`.

### Module B — File Management (`FILE`)

| ID | Requirement |
|---|---|
| FR-FILE-01 | Support PDF, images (PNG/JPG/WebP/GIF), video (MP4/WebM), documents (DOCX/XLSX/PPTX/TXT/MD/CSV). |
| FR-FILE-02 | Uploads go browser → S3 directly via backend-issued pre-signed PUT (15 min validity, content-type/length constrained). |
| FR-FILE-03 | Finalize only after backend HEAD-verifies the object exists with matching size; status becomes `READY`. |
| FR-FILE-04 | Downloads/previews served via pre-signed GET (`inline` for preview, `attachment` for download); never streamed through the API. |
| FR-FILE-05 | Max size 100 MB enforced at presigning and re-verified from S3. |
| FR-FILE-06 | Delete is soft (`deletedAt` set); trash retained 30 days with nightly purge job. |
| FR-FILE-07 | Restore clears `deletedAt`; file returns to its previous folder (root if folder was purged). |
| FR-FILE-08 | Permanent purge deletes the S3 object and metadata only via background job or explicit trash action. |
| FR-FILE-09 | Preview: images inline; PDF embedded viewer; video range-streaming; Office types show thumbnail or graceful fallback. |
| FR-FILE-10 | Listing supports cursor pagination, category/date filters, name/size/date sort. |
| FR-FILE-11 | Every mutating action writes an activity-log entry. |

**Upload path** — *In:* `{filename, size, mimeType, folderId?}` · *Proc:* quota check → deterministic `s3Key` (`users/{ownerId}/{yyyy}/{mm}/{uuid}.{ext}`) → pre-signed PUT → client uploads → finalize call → HEAD verify → metadata insert → enqueue AI job if text-bearing · *Out:* `202 {fileId, uploadUrl}` then `201 {file}`.

### Module C — Folder Management (`FOLDER`)

| ID | Requirement |
|---|---|
| FR-FOLDER-01 | Create folders in root or any owned subfolder; sibling names unique per owner. |
| FR-FOLDER-02 | Rename folders; uniqueness revalidated among siblings. |
| FR-FOLDER-03 | Move files between owned folders; move folders unless target is a descendant of source (`409`). |
| FR-FOLDER-04 | Arbitrary nesting (cap 20 levels). |
| FR-FOLDER-05 | Folder delete soft-deletes subtree recursively; restore reverses parent-first. |

### Module D — Search (`SEARCH`)

*Phase 1 — metadata search*

| ID | Requirement |
|---|---|
| FR-SEARCH-01 | Filename substring/prefix search (trigram-indexed). |
| FR-SEARCH-02 | Filter by MIME category. |
| FR-SEARCH-03 | Filter by uploaded-date range. |
| FR-SEARCH-04 | Rank exact > prefix > substring, then recency; paginated. |

*Phase 5 — AI semantic search*

| ID | Requirement |
|---|---|
| FR-SEARCH-05 | Meaning-based hits regardless of filenames. |
| FR-SEARCH-06 | Natural-language query → embedding → top-k ANN (default k=8). |
| FR-SEARCH-07 | Retrieval hard-scoped to documents the caller may read (tenant isolation). |

### Module E — Sharing (`SHARE`)

| ID | Requirement |
|---|---|
| FR-SHARE-01 | Owners generate links for owned files. |
| FR-SHARE-02 | Permissions: `VIEW` (preview only) or `DOWNLOAD`. |
| FR-SHARE-03 | Optional absolute expiry; expired ⇒ `410`. |
| FR-SHARE-04 | Optional password (bcrypt-hashed, checked before presigning). |
| FR-SHARE-05 | Instant revocation; optional max-download cap. |
| FR-SHARE-06 | Tokens: 128-bit CSPRNG base64url, opaque, not derivable from file IDs. |
| FR-SHARE-07 | Every redemption logged (timestamp, IP, outcome). |

### Module F — AI Document Assistant (`AI`)

| ID | Requirement |
|---|---|
| FR-AI-01 | Text-bearing uploads auto-enqueue extraction jobs; acknowledgement never blocks on AI work. |
| FR-AI-02 | Chunking ~800–1000 tokens with 10–15% overlap, section-aware. |
| FR-AI-03 | Chunks embedded and stored with `{fileId, userId, chunkIndex, page}` in the vector DB. |
| FR-AI-04 | `POST /ai/query` answers questions scoped to one file or the whole permitted library. |
| FR-AI-05 | Answers cite `[file, page/chunk]`; low retrieval confidence ⇒ explicit "not found" refusal, never fabrication. |
| FR-AI-06 | Re-index endpoint recovers failed processing; status observable (`PENDING→PROCESSING→INDEXED|FAILED`). |
| FR-AI-07 | AI endpoints enforce identical authorization to file reads. |

---

## 3. Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-PERF-01 | Performance | Metadata API p95 ≤ 300 ms @ 50 concurrent users | k6 load test |
| NFR-PERF-02 | Performance | Pre-signed URL issuance p95 ≤ 150 ms (local signing) | Load test |
| NFR-PERF-03 | Performance | Filename search p95 ≤ 500 ms @ 100k rows | Seeded load test |
| NFR-PERF-04 | Performance | Semantic search p95 ≤ 1.5 s; RAG answer p95 ≤ 8 s end-to-end | Eval harness timing |
| NFR-SCAL-01 | Scalability | Stateless API tier scales horizontally behind ALB | Architecture review |
| NFR-SCAL-02 | Scalability | Storage scales with zero application change | Design inspection |
| NFR-SCAL-03 | Scalability | AI service deploys/scales independently | Deployment test |
| NFR-SEC-01 | Security | HTTPS/TLS 1.2+ everywhere | Config audit |
| NFR-SEC-02 | Security | bcrypt ≥ cost 10; secrets never in code/logs/git | Review + secret scanning |
| NFR-SEC-03 | Security | Authorization middleware on every resource access | Integration tests |
| NFR-AVAIL-01 | Availability | ≥ 99% monthly uptime during demo period | Uptime monitor |
| NFR-AVAIL-02 | Availability | RPO ≤ 24 h; RTO ≤ 4 h (restore drill proof) | Drill |
| NFR-MAINT-01 | Maintainability | Layered modules, documented boundaries; OpenAPI authoritative contract | Review checklist |
| NFR-MAINT-02 | Maintainability | ≥ 70% unit coverage on core modules | CI gate |
| NFR-OBS-01 | Observability | Structured JSON logs with request IDs; latency/error dashboards | CloudWatch review |

---

## 4. Success Metrics

| Metric | Target |
|---|---|
| Upload success rate (≤100 MB) | ≥ 99.5% |
| Golden-question recall@3 (semantic search) | ≥ 80% |
| Grounded-answer rate (RAG cites real sources) | ≥ 90% of answered queries |
| Refusal correctness (out-of-corpus questions refused) | ≥ 95% |
