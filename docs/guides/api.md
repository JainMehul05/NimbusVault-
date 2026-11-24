# API reference

Base path `/api/v1`. JSON envelope: `{ success, message, data | error: { code, details }, meta: { requestId, timestamp } }`. Authenticated calls send `Authorization: Bearer <access token>`.

## Authentication

| Call | Notes |
|---|---|
| `POST /auth/register` `{name,email,password}` | 201. Password: 8+ characters (72 bytes at most), a letter and a number or symbol |
| `POST /auth/login` `{email,password}` | With `X-Auth-Transport: cookie` the refresh token is only in the cookie; otherwise also in the body |
| `POST /auth/refresh` | Cookie + `X-Requested-With: XMLHttpRequest`, or body `{refreshToken,tokenFamily}`. 409 `REFRESH_CONFLICT`: lost a race, retry |
| `POST /auth/logout` | Cookie, or body `{tokenFamily}` |
| `GET /auth/me` | |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `DELETE /auth/sessions` | List, end one, end all others |
| `POST /auth/change-password` `{currentPassword,newPassword}` | Signs out other devices |

## Files

| Call | Notes |
|---|---|
| `POST /files` multipart `file`, `folderId?` | Duplicate names are numbered. Editors may upload to shared folders |
| `POST /files/presigned-upload` `{filename,contentType,sizeBytes,folderId?,checksumSha256?}` | Reserves quota; returns `{fileId,url,method,headers,expiresIn}` |
| `POST /files/:id/complete` · `DELETE /files/:id/upload` | Verify and finish (idempotent); cancel and refund |
| `GET /files` `?folderId=root\|id&search&category&page&limit&sortBy&sortOrder` | |
| `GET /files/:id` · `GET /files/:id/download?inline=` · `GET /files/storage/info` | Download URLs last 5 minutes |
| `PATCH /files/:id/rename` `{filename}` · `PATCH /files/:id/move` `{folderId}` · `DELETE /files/:id` | Delete moves to trash (owner) |

## Folders and trash

| Call | Notes |
|---|---|
| `POST /folders` · `GET /folders` · `GET /folders/tree/:id?` · `GET /folders/:id\|root/contents` | Contents works for shared folders |
| `PATCH /folders/:id/rename` · `/move` · `DELETE /folders/:id?deleteDescendants=true` | Owner |
| `GET /trash` · `POST /trash/files\|folders/:id/restore` · `DELETE /trash/files\|folders/:id` · `DELETE /trash` | Owner; restore re-checks quota |

## Sharing

| Call | Notes |
|---|---|
| `POST /sharing` `{resourceType,resourceId,granteeEmail,level}` · `GET /sharing/:type/:id` | Owner or Editor |
| `PATCH` · `DELETE /sharing/:type/:id/:granteeId` | Owner |
| `GET /sharing/me/shared-with-me?page&limit` · `GET /sharing/me/shared-by-me` | |
| `POST /share-links/protected` `{fileId,permission,password?,expiresAt?,maxDownloads?}` · `GET /share-links/protected/:fileId` · `DELETE /share-links/protected/:id` | The token is shown once |
| `GET /share-links/public/:token` · `/download` | Password in `X-Share-Password` (add `X-Share-Password-Encoding: percent` for percent-encoded UTF-8) |

## Activity, AI, health

| Call | Notes |
|---|---|
| `GET /activity` · `/activity/me` · `/activity/resource/:type/:id` | Own feed only; resource history is owner only |
| `GET /ai/status` · `POST /ai/search` · `POST /ai/ask` | 503 `AI_PROVIDER_UNAVAILABLE` when not configured |
| `GET /ai/files/:id` · `/text` · `/chunks/:n` · `POST /ai/files/:id/index` · `/summary` | |
| `GET /health` · `GET /health/ready` | Liveness; database and storage readiness |

## Breaking changes in this release

- `POST /files/presigned-upload` requires `sizeBytes` and must be followed by `/complete`.
- Access tokens issued before the upgrade are rejected (no session id); clients refresh once.
- Presigned download URLs last 5 minutes instead of 1 hour and always download as attachments unless `inline=true` is allowed for the type.
- Share links must expire in the future when created; new passwords follow the policy above.
- `GET /files` lists finished files only.
