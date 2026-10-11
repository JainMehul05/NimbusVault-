# NimbusVault — REST API Specification

| Field | Value |
|---|---|
| Document | Phase 0 · API Contract v1 (Hardened) |
| Base URL | `https://api.<host>/api/v1` (dev: `http://localhost:3000/api/v1`) |
| Style | REST · JSON · UTF-8 · OpenAPI 3.1 (spec file is authoritative) |
| Auth | `Authorization: Bearer <accessToken>` unless marked **Public** |

---

## 1. Conventions

### 1.1 General Rules

- Versioned prefix `/api/v1/` — breaking changes ship as `/v2`, never in-place.
- All request/response bodies are JSON; uploads/downloads use pre-signed S3 URLs, never API bodies.
- Timestamps are ISO-8601 UTC. IDs are UUIDs.
- Cursor pagination on list endpoints: `?limit=` (default 25, max 100) + `?cursor=`; responses include `nextCursor` (`null` = end).
- Mutating endpoints write an activity-log entry server-side.
- Every response includes a `requestId` for traceability.

### 1.2 Standardized Response Envelope

**Success responses (2xx)** return resource JSON directly with metadata:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_01J9ZK...",
    "timestamp": "2026-08-23T10:00:00Z"
  }
}
```

**Error responses (non-2xx)** use a flat, machine-readable shape:

```json
{
  "success": false,
  "message": "No accessible file with id '9f...'",
  "errorCode": "FILE_NOT_FOUND",
  "requestId": "req_01J9ZK...",
  "details": [{ "field": "folderId", "issue": "must be a UUID" }]
}
```

- `errorCode` — stable SCREAMING_SNAKE string; clients branch on it, never on `message` text.
- `message` — human-readable, safe to display; never leaks internals (stack traces, SQL).
- `requestId` — correlates the response with structured logs for debugging.
- `details` — present only for `400 VALIDATION_ERROR`, listing per-field issues.

| Status | Meaning | Typical Codes |
|---|---|---|
| 400 | Malformed input / validation failure | `VALIDATION_ERROR`, `INVALID_CURSOR` |
| 401 | Missing/expired/denylisted token | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` |
| 403 | Authenticated but not permitted / quota | `FORBIDDEN`, `QUOTA_EXCEEDED` |
| 404 | Resource absent or not owned (indistinguishable by design) | `FILE_NOT_FOUND`, `FOLDER_NOT_FOUND` |
| 409 | Conflict with current state | `NAME_CONFLICT`, `FOLDER_CYCLE`, `S3_OBJECT_MISSING` |
| 410 | Share link expired or revoked | `SHARE_EXPIRED`, `SHARE_REVOKED` |
| 413 | Payload beyond limits | `FILE_TOO_LARGE` |
| 415 | Unsupported media type | `UNSUPPORTED_TYPE` |
| 422 | Upload finalize failed verification | `UPLOAD_INCOMPLETE` |
| 429 | Rate limit exceeded | `RATE_LIMITED` (+ `Retry-After` header) |
| 500 | Unexpected server fault | `INTERNAL` |

### 1.3 Pagination, Filtering, Sorting

**Cursor Pagination** (all list endpoints):
```
GET /files?limit=25&cursor=abc123
```
Response includes `nextCursor` (null = end). Default limit 25, max 100.

**Filtering** (endpoint-specific):
```
GET /files?category=pdf&from=2026-01-01&to=2026-12-31&q=lecture
GET /search?q=normalization&category=document&from=2026-08-01
```

**Sorting** (endpoint-specific):
```
GET /files?sort=-uploadedAt  (prefix - for DESC)
GET /files?sort=name         (default ASC)
```
Allowed fields documented per endpoint.

### 1.4 Rate Limits (per user/IP)

| Endpoint Class | Limit |
|---|---|
| `POST /auth/login` | 5/min per IP + exponential lockout |
| `POST /auth/register` | 3/min per IP |
| File/folder CRUD | 60/min |
| `POST /files/upload-url` | 30/min |
| AI endpoints | 10/min |
| Public share redemption | 20/min per token+IP |

---

## 2. Authentication APIs

### 2.1 Register — `POST /auth/register` · Public

Creates an account and returns tokens (session starts immediately).

**Request**
```json
{ "name": "Aarav Sharma", "email": "aarav@example.com", "password": "S3curePass!" }
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "user": { "id": "u_7c9...", "name": "Aarav Sharma", "email": "aarav@example.com", "createdAt": "2026-08-23T10:00:00Z" },
    "accessToken": "eyJhbGciOiJ...",
    "refreshToken": "d9f2c1...",
    "refreshTokenFamily": "8b7bd8cd-...",
    "expiresIn": 900
  },
  "meta": { "requestId": "req_01J9ZK...", "timestamp": "2026-08-23T10:00:00Z" }
}
```

**Errors:** `400 VALIDATION_ERROR` (weak password/bad email) · `409 EMAIL_TAKEN`.

### 2.2 Login — `POST /auth/login` · Public

Validates credentials; issues new token pair.

**Request:** `{ "email": "aarav@example.com", "password": "..." }`
**Response `200`:** same shape as register's.
**Errors:** `401 INVALID_CREDENTIALS` (generic — identical for unknown email and wrong password).

### 2.3 Refresh — `POST /auth/refresh` · Public

Exchanges a valid refresh token for a new pair (rotation: old refresh is invalidated; reuse of an invalidated token revokes the whole family — theft detection).

**Request:** `{ "refreshToken": "d9f2c1...", "refreshTokenFamily": "8b7bd8cd-..." }`
**Response `200`:** `{ accessToken, refreshToken, refreshTokenFamily, expiresIn }`
**Errors:** `401 INVALID_REFRESH_TOKEN` · `401 TOKEN_REUSE_DETECTED`.

### 2.4 Logout — `POST /auth/logout` 🔒

Denylists the presented access token's JTI until expiry and revokes the refresh family.

**Request:** `{ "refreshTokenFamily": "8b7bd8cd-..." }`
**Response `204 No Content`**

### 2.5 Current User — `GET /auth/me` 🔒

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "u_7c9...", "name": "Aarav Sharma", "email": "aarav@example.com",
    "storage": { "quotaBytes": 5368709120, "usedBytes": 734003200 },
    "role": "user",
    "status": "active",
    "lastLoginAt": "2026-08-23T10:00:00Z",
    "createdAt": "2026-08-23T10:00:00Z"
  },
  "meta": { "requestId": "req_01J9ZK...", "timestamp": "2026-08-23T10:00:00Z" }
}
```
**Errors:** `401 UNAUTHORIZED` · `401 TOKEN_REVOKED`.

### 2.6 Password Change — `POST /auth/password` 🔒

**Request:** `{ "currentPassword": "...", "newPassword": "NewS3curePass!" }`
**Response `200`:** `{ "message": "Password updated; all other sessions revoked" }`
**Errors:** `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS`.

### 2.7 Sessions — `GET /auth/sessions` 🔒

Lists active sessions for the current user.

**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "sess_...", "device": "Chrome on macOS", "ipAddress": "192.0.2.1", "createdAt": "...", "lastUsedAt": "...", "current": true }
  ]
}
```

### 2.8 Revoke Session — `DELETE /auth/sessions/:sessionId` 🔒

Revokes a specific session (or all except current with `?allExceptCurrent=true`).

**Response `204`**

---

## 3. File APIs

Uploads are **two-phase**: (1) mint a pre-signed PUT, (2) finalize metadata after the browser uploads directly to S3.

### 3.1 Create Upload URL — `POST /files/upload-url` 🔒

Checks quota, then signs a constrained PUT.

**Request**
```json
{ "filename": "lecture-05.pdf", "size": 2411724, "mimeType": "application/pdf", "folderId": null }
```
**Response `202`**
```json
{
  "success": true,
  "data": {
    "fileId": "f_51b...",
    "uploadUrl": "https://nimbusvault.s3.amazonaws.com/users/u_7c9/2026/08/9a....pdf?X-Amz-...",
    "method": "PUT",
    "headers": { "Content-Type": "application/pdf" },
    "expiresIn": 900,
    "status": "UPLOADING"
  },
  "meta": { "requestId": "req_01J9ZK...", "timestamp": "2026-08-23T10:00:00Z" }
}
```
**Errors:** `403 QUOTA_EXCEEDED` · `413 FILE_TOO_LARGE` (>100 MB) · `415 UNSUPPORTED_TYPE` · `404 FOLDER_NOT_FOUND`.

### 3.2 Finalize Upload — `POST /files` 🔒

Called after the browser completes the S3 PUT. Backend HEADs the object (existence + size match + checksum), flips status to `READY`, enqueues the AI extraction job when applicable.

**Request:** `{ "fileId": "f_51b...", "checksumSha256": "a1b2c3..." }`
**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "f_51b...", "filename": "lecture-05.pdf", "sizeBytes": 2411724,
    "mimeType": "application/pdf", "category": "pdf", "folderId": null,
    "status": "READY", "aiStatus": "PENDING", "checksumSha256": "a1b2c3...",
    "uploadedAt": "2026-08-23T10:02:11Z"
  },
  "meta": { "requestId": "req_01J9ZK...", "timestamp": "2026-08-23T10:02:11Z" }
}
```
**Errors:** `422 UPLOAD_INCOMPLETE` (object absent/size mismatch/checksum mismatch) · `409 ALREADY_FINALIZED`.

### 3.3 List Files — `GET /files` 🔒

Query parameters:
| Param | Type | Description |
|---|---|---|
| `folderId` | UUID | Omit for root |
| `q` | string | Filename contains (trigram search) |
| `category` | enum | `pdf|image|video|document|other` |
| `from` / `to` | ISO date | Uploaded date range |
| `sort` | string | `name`, `-name`, `size`, `-size`, `uploadedAt`, `-uploadedAt` (default) |
| `trash` | boolean | `true` lists soft-deleted |
| `limit` | int | 1-100 (default 25) |
| `cursor` | string | Pagination cursor |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "f_51b...", "filename": "lecture-05.pdf", "sizeBytes": 2411724,
        "mimeType": "application/pdf", "category": "pdf", "status": "READY",
        "aiStatus": "INDEXED", "uploadedAt": "2026-08-23T10:02:11Z" }
    ],
    "nextCursor": null
  },
  "meta": { "requestId": "req_01J9ZK...", "timestamp": "2026-08-23T10:00:00Z" }
}
```

### 3.4 Get File Metadata — `GET /files/:id` 🔒

Returns full metadata incl. folder path breadcrumb. Owner or granted viewer/editor only.
**Errors:** `404 FILE_NOT_FOUND`.

### 3.5 Get Download/Preview URLs — `GET /files/:id/download-url?disposition=inline|attachment` 🔒

Mints short-lived pre-signed GET(s). `inline` powers preview players/viewers; `attachment` forces download. Owner/viewer/editor only.

**Response `200`:** `{ "success": true, "data": { "url": "https://...", "expiresIn": 900, "filename": "lecture-05.pdf" }, "meta": {...} }`
**Errors:** `404` · `403 FORBIDDEN`.

### 3.6 Update File — `PATCH /files/:id` 🔒

Partial update: rename and/or move. Owner or editor.

**Request:** `{ "filename": "DBMS-unit-3.pdf", "folderId": "fo_e21..." }`
**Response `200`:** updated file object.
**Errors:** `400 VALIDATION_ERROR` · `404` · `403 FORBIDDEN` (viewer cannot mutate) · `409 NAME_CONFLICT`.

### 3.7 Delete File (Soft) — `DELETE /files/:id` 🔒

Sets `deleted_at`; file disappears from listings, appears in trash. Owner or editor.
**Response:** `204`. **Errors:** `404`.

### 3.8 Restore File — `POST /files/:id/restore` 🔒

Clears `deleted_at` if the destination folder still exists (else restores to root). Owner or editor.
**Response `200`:** restored file object.

### 3.9 Purge File (Permanent) — `DELETE /files/:id/purge` 🔒

Only from trash. Deletes S3 object (delete-marker via versioning) + row, releases quota.
**Response:** `204`. **Errors:** `404 NOT_IN_TRASH`.

### 3.10 File Checksum — `GET /files/:id/checksum` 🔒

Returns the stored SHA-256 checksum for integrity verification.

**Response `200`**
```json
{ "success": true, "data": { "checksumSha256": "a1b2c3..." }, "meta": {...} }
```

---

## 4. Folder APIs

### 4.1 Create Folder — `POST /folders` 🔒

**Request:** `{ "name": "Semester 5", "parentFolderId": null }` (null ⇒ root)
**Response `201`:** `{ "id": "fo_e21...", "name": "Semester 5", "parentId": null, "depth": 0, "createdAt": "..." }`
**Errors:** `409 NAME_CONFLICT` · `404 PARENT_NOT_FOUND` · `400 MAX_DEPTH_EXCEEDED`.

### 4.2 List Folder Contents — `GET /folders/:id/children?types=folders,files&sort=name` 🔒

Single round-trip browse: returns immediate sub-folders and files (both paginated blocks). Omit `:id` or use `/folders/root/children` for the user root.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "path": [{ "id": null, "name": "My Vault" }, { "id": "fo_e21...", "name": "Semester 5" }],
    "folders": [{ "id": "fo_9aa...", "name": "DBMS" }],
    "files":   [{ "id": "f_51b...", "filename": "lecture-05.pdf", "sizeBytes": 2411724 }],
    "nextFolders": null, "nextFiles": null
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

### 4.3 Rename Folder — `PATCH /folders/:id` 🔒

**Request:** `{ "name": "Semester VI" }` — sibling uniqueness revalidated. **Errors:** `409 NAME_CONFLICT`, cycle check applies if `parentId` also supplied.

### 4.4 Move File/Folder — covered by `PATCH /files/:id` and `PATCH /folders/:id` (`parentId` field). Moving a folder under its own descendant ⇒ `409 FOLDER_CYCLE`.

### 4.5 Delete Folder — `DELETE /folders/:id` 🔒

Recursive soft delete of subtree (folder + contents) into trash. **Response:** `204`. Restore endpoint mirrors it (`POST /folders/:id/restore`) restoring parent-first.

---

## 5. Sharing APIs

### 5.1 Create Share Link — `POST /files/:id/share` 🔒 Owner only

**Request**
```json
{ "permission": "DOWNLOAD", "expiresAt": "2026-09-30T23:59:59Z", "password": "vault123", "maxDownloads": 25 }
```
All fields optional except `permission`.
**Response `201`**
```json
{ "success": true, "data": { "id": "sl_c3d...", "token": "8Kj2mQ...", "url": "https://app.<host>/s/8Kj2mQ...",
  "permission": "DOWNLOAD", "hasPassword": true,
  "expiresAt": "2026-09-30T23:59:59Z", "maxDownloads": 25, "createdAt": "..." },
"meta": {...} }
```
**Errors:** `403 NOT_OWNER`.

### 5.2 List Links for a File — `GET /files/:id/share` 🔒 Owner only → array of link objects with live status (`ACTIVE | EXPIRED | REVOKED | EXHAUSTED`).

### 5.3 Revoke Link — `DELETE /share/:linkId` 🔒 Owner only → `204` (sets `revoked_at`; token dies immediately).

### 5.4 Resolve Share Token — `GET /share/:token` · Public

Validates the link and, if password-protected, expects the password via header/body challenge.

**Request:** `{ }` or `{ "password": "vault123" }`
**Response `200`**
```json
{
  "success": true,
  "data": {
    "filename": "lecture-05.pdf", "sizeBytes": 2411724, "mimeType": "application/pdf",
    "permission": "DOWNLOAD",
    "previewUrl":   "https://... (disposition=inline, 15-min TTL)",
    "downloadUrl":  "https://... (disposition=attachment)",
    "expiresAt": "2026-09-30T23:59:59Z"
  },
  "meta": {...}
}
```
`downloadUrl` omitted when permission = VIEW.
**Errors:** `404 SHARE_NOT_FOUND` · `401 PASSWORD_REQUIRED / INVALID_PASSWORD` · `410 SHARE_EXPIRED / SHARE_REVOKED / SHARE_EXHAUSTED`. Every redemption attempt is logged.

---

## 6. Search APIs

### 6.1 Metadata Search — `GET /search?q=&category=&from=&to=&limit=&cursor=` 🔒

Filename substring/prefix search across all non-deleted owned+granted files; ranked exact > prefix > contains, then recency.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "f_51b...", "filename": "lecture-05-normalization.pdf",
        "matchField": "filename", "score": 0.98, "folderPath": "Semester 5/DBMS",
        "sizeBytes": 2411724, "uploadedAt": "2026-08-23T10:02:11Z" }
    ],
    "nextCursor": null
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```
Errors: `400 INVALID_FILTER_COMBINATION`.

### 6.2 Semantic Search — `POST /search/semantic` 🔒 *(Phase 5)*

Meaning-based retrieval over indexed documents, hard-scoped to files the caller may read.

**Request:** `{ "query": "which notes explain BCNF with examples?", "topK": 8, "filters": { "category": "pdf" } }`
**Response `200`**
```json
{
  "success": true,
  "data": {
    "results": [
      { "fileId": "f_51b...", "filename": "lecture-05-normalization.pdf",
        "snippet": "...a relation is in BCNF if, for every non-trivial FD X→Y, X is a superkey...",
        "page": 12, "score": 0.87 }
    ],
    "latencyMs": 742
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```
Errors: `409 AI_NOT_INDEXED` (no indexed content yet).

---

## 7. AI APIs *(Phase 4–5)*

The backend proxies these to the Python AI service; clients never call the AI service directly.

### 7.1 Ask a Document Question (RAG) — `POST /ai/query` 🔒

**Request:** `{ "question": "Summarize the storage quota policy.", "fileId": null, "topK": 6 }`
(`fileId` scopes the answer to one document; null searches the whole permitted library.)

**Response `200`**
```json
{
  "success": true,
  "data": {
    "answer": "NimbusVault enforces a per-user quota of 5 GB by default... [1][2]",
    "sources": [
      { "fileId": "f_51b...", "filename": "lecture-05.pdf", "page": 3, "chunkIndex": 14 },
      { "fileId": "f_77c...", "filename": "handbook.docx",  "page": null, "chunkIndex": 2 }
    ],
    "confidence": 0.81,
    "latencyMs": 5120
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```
Low-confidence guardrail: when retrieval scores fall below threshold the API returns `200` with `"answer": "I could not find this in your documents."` and empty `sources` — never an invented answer.
**Errors:** `409 AI_NOT_INDEXED` · `429 RATE_LIMITED` · upstream LLM failure maps to `502 AI_PROVIDER_UNAVAILABLE`.

### 7.2 Indexing Status — `GET /ai/status/:fileId` 🔒
→ `{ "success": true, "data": { "aiStatus": "PROCESSING", "progress": 0.4, "error": null }, "meta": {...} }`

### 7.3 Re-index — `POST /ai/reindex/:fileId` 🔒 Owner only
Re-enqueues extraction/embedding after a failure. → `202 Accepted`.

---

## 8. Health & Operations

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | Public | Liveness: process up |
| `GET /health/ready` | Public | Readiness: DB reachable, Redis reachable, S3 credentials valid, queue not backed up |

---

## 9. Request ID Propagation

Every request receives a `requestId` (UUID v4) generated at the API gateway / first middleware. This ID:
- Is returned in all response `meta.requestId`
- Is included in all structured log entries for the request
- Is passed to downstream services via headers (`x-request-id`)
- Enables end-to-end traceability in logs and metrics

---

*This contract is maintained as an OpenAPI 3.1 document generated from controller decorators; CI fails on drift between spec and implementation.*