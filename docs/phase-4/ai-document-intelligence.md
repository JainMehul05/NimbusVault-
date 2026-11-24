# Phase 4 — AI Document Intelligence

NimbusVault indexes the documents users store and offers semantic search, AI summaries and
grounded question answering (RAG) — strictly limited to documents the requesting user can
currently read. AI is optional: with no provider configured, storage, sharing and activity work
exactly as before and every AI endpoint reports `503 AI_PROVIDER_UNAVAILABLE`.

## 1. Architecture

```
upload ──► files + S3 ──► ai_jobs (QUEUED) ──► worker (separate process in production; FOR UPDATE SKIP LOCKED)
                                                   │
                     download from S3 ◄────────────┘
                     extract (pdf-parse/pdf.js · mammoth · UTF-8 text)
                     normalize → chunk (1200 chars, 200 overlap, boundary-aware)
                     embed (local MiniLM | OpenAI-compatible)
                     atomic swap in one transaction (generation check + row lock):
                       document_chunks (pgvector)  +  document_indexes (text, metadata)
                     optional summary (bounded map-reduce)
search / ask ──► embed query ──► SQL: accessible_files CTE ⋈ chunks ⋈ current generation
                                 ORDER BY cosine distance  (authorization *inside* the query)
             ──► re-check access per file ──► (ask) prompt with <source> blocks ──► LLM
             ──► validate [S#] citations against supplied sources
```

| Module (`backend/src/modules/ai/`) | Responsibility |
|---|---|
| `extraction.ts` | Content sniffing, PDF/DOCX/Markdown/text extraction, limits, OCR-required detection |
| `chunking.ts` | Deterministic overlap-aware chunking with page mapping |
| `providers/` | Embedding + generation provider abstraction (local, OpenAI-compatible, Anthropic) |
| `vector-store.ts` | pgvector inserts and authorization-scoped similarity search |
| `indexing.service.ts` | Enqueue (generations), job processing, retries/backoff, purge on delete |
| `worker.ts` | Durable DB-backed worker, concurrency limit, stale-lock recovery, graceful stop |
| `summary.service.ts` | Summaries (single pass ≤12k chars; else ≤6 sections + combine) |
| `rag.service.ts` / `prompts.ts` | Retrieval, grounded answers, citation validation, injection hardening |
| `ai.controller.ts` / `ai.routes.ts` | REST API, validation, per-user rate limits |

### Providers and models

| Purpose | Provider (`AI_*_PROVIDER`) | Default model | Notes |
|---|---|---|---|
| Embeddings | `local` | `Xenova/all-MiniLM-L6-v2`, 384 dims (ADR-010) | Runs on server CPU via `@huggingface/transformers` (optional dependency). Text never leaves the server. Model (about 90 MB, fp32; baked into the production image) is cached in `AI_LOCAL_MODEL_CACHE_DIR`. |
| Embeddings | `openai` | `text-embedding-3-small`, 1536 dims | Any OpenAI-compatible `/embeddings` endpoint (OpenAI, Ollama, vLLM). |
| Generation | `openai` | `gpt-4o-mini` (ADR-012) | OpenAI-compatible `/chat/completions` (also local Ollama). |
| Generation | `anthropic` | `claude-haiku-5-5` | Anthropic Messages API (documented fallback). |

Every vector stores its model id (`local:Xenova/all-MiniLM-L6-v2@384`). Search only compares
vectors with the currently configured id, so changing model or dimensions never mixes
incompatible embeddings — re-index documents after switching (Document insights → Re-index).
The `embedding` column is an untyped pgvector `vector` so different deployments can choose
different dimensions. Search is an exact scan restricted to the caller's accessible files; above
`AI_SEARCH_ANN_THRESHOLD` (20,000) accessible chunks, 384-dimension models use an HNSW index with
pgvector iterative scans and the same permission filter.

### Data model (migration `20261123000000_security_fixes_and_ai_documents`)

| Table | Purpose | Deletion |
|---|---|---|
| `document_indexes` | One row per file: extracted text, page count, truncation flag, embedding model, chunk count, summary + status/model/coverage, error code, current `generation` | `ON DELETE CASCADE` from `files`; purged on soft delete |
| `document_chunks` | Passages with char offsets, page range, token estimate, model id, `vector` embedding | Cascade; purged on soft delete; replaced atomically on re-index |
| `ai_jobs` | Durable jobs: status, attempts, `runAfter` backoff, lock owner/time, last error | Cascade; cancelled on delete/supersede |
| `files.aiStatus` | `NA` (not indexed) · `PENDING` · `PROCESSING` · `INDEXED` · `FAILED` · `UNSUPPORTED` | — |

Rollback: the migration is additive. To roll back, drop `ai_jobs`, `document_chunks`,
`document_indexes`, the `tokenLookup` and `targetOwnerId` columns and the new enum types/values
(enum values cannot be removed in PostgreSQL without recreating the type; unused values are
harmless). Back up first; dropping these tables deletes extracted text and vectors only — files
in S3 and core metadata are untouched.

### Jobs: reliability properties

- **Never in the request path.** Upload only inserts a job row; work happens in the worker.
- **Idempotent.** Each (re)index request increments `document_indexes.generation` under a row
  lock and cancels older queued jobs. A job writes results only if its generation is still
  current (checked under `SELECT … FOR UPDATE`); stale results are discarded.
- **Retries.** Transient provider errors (timeouts, 429, 5xx) retry with exponential backoff
  (15 s, 30 s, … ≤ 10 min) up to `AI_JOB_MAX_ATTEMPTS`; permanent errors (bad key, corrupt file)
  fail immediately. Failures never touch the stored file.
- **Restart recovery.** Jobs left `RUNNING` by a crashed process are re-queued after
  `AI_WORKER_STALE_LOCK_MS`. Multiple API instances can run workers safely (`SKIP LOCKED`).
- **Bounded.** `AI_WORKER_CONCURRENCY` jobs at a time; graceful shutdown waits ≤ 20 s.

## 2. Security and privacy

- **Authorization inside retrieval.** The vector query joins an `accessible_files` recursive CTE
  (owned files, direct file grants, and files in transitively shared folders, excluding anything
  soft-deleted). Results are re-checked per file before any snippet leaves the server. Revoking a
  share or deleting a folder therefore removes AI access on the very next request — there is no
  cache to invalidate.
- **Share links never grant AI access.** All `/ai/*` routes require an account token.
- **Writes are restricted.** Re-index and summary generation (which spend compute/budget) need
  Owner or Editor; Viewers can read status, text, summaries, search and ask.
- **Prompt injection.** Document text appears only inside `<source>`/`<document>` blocks in the
  user turn; delimiter look-alikes inside documents are neutralised; the system prompt (which no
  document can reach) instructs the model to treat sources as data and never follow embedded
  instructions. Citations to sources that were not supplied are stripped, and answers without any
  valid citation are flagged `ungrounded` in the UI.
- **Insufficient evidence.** If retrieval finds nothing above `AI_SEARCH_MIN_SCORE`, the model is
  not called at all and the API returns `insufficient_evidence`.
- **Cost / abuse limits.** Per-user rate limits (`AI_QUERY_RATE_LIMIT` per 10 min; search 3×),
  bounded generation concurrency (`AI_MAX_CONCURRENT_GENERATIONS`, overflow → 429 `AI_BUSY`),
  capped question length (1000), context (`AI_MAX_CONTEXT_CHARS`), output tokens, file size
  (`AI_MAX_FILE_BYTES`), PDF pages and extracted characters, and summaries ≤ 7 model calls.
- **Extraction safety.** Magic-byte sniffing (a `.pdf` must start with `%PDF-`, DOCX with a ZIP
  header, text must be valid UTF-8 without NUL bytes). PDF.js runs with `isEvalSupported:false`,
  XFA off, text extraction only — embedded JavaScript is never executed. DOCX is read with mammoth
  (XML text only; macros never run). Encrypted, corrupted and scanned/image-only PDFs are reported
  as `ENCRYPTED`, `CORRUPTED`, `OCR_REQUIRED` — never as an empty success. With `AI_OCR_ENABLED=true`,
  scanned PDFs are read locally with tesseract.js (bundled data, page and time limits); it is off by default.
- **Logging.** No document text, questions, prompts or keys are logged; the `ai_query` audit
  event stores only the question length and outcome. Provider error messages never include
  request bodies.
- **Third-party disclosure.** `GET /ai/status` reports `privacy.sendsDocumentsToThirdParty`
  (true when a non-local provider endpoint is configured); the UI shows a disclosure in that
  case. With `AI_EMBEDDING_PROVIDER=local` and no generation provider, no document data leaves
  the server.
- **Retention.** Extracted text, chunks and vectors are deleted when the file is deleted
  (soft delete included) and replaced on re-index.

## 3. API

All endpoints are under `/api/v1/ai`, require `Authorization: Bearer <access token>`, and use
the standard envelope `{ success, message, data | error: { code, details }, meta: { requestId, timestamp } }`.

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /status` | any user | Capabilities, models, limits, privacy flag (no secrets) |
| `GET /files/:fileId` | read | Indexing status, error, extraction info, summary, latest job |
| `POST /files/:fileId/index` | write (owner/editor) | Queue (re)indexing → `202` |
| `GET /files/:fileId/text?offset&limit` | read | Extracted text page (≤ 20 000 chars) |
| `GET /files/:fileId/chunks/:chunkIndex` | read | One cited passage |
| `POST /files/:fileId/summary` | write | (Re)generate summary |
| `POST /search` | — (results filtered to readable files) | Semantic search |
| `POST /ask` | — (retrieval filtered to readable files) | Grounded Q&A |

Error codes: `AI_PROVIDER_UNAVAILABLE` (503, not configured), `AI_PROVIDER_ERROR` (503, provider
failed), `AI_NOT_INDEXED` (404/400), `AI_BUSY` / `RATE_LIMIT_EXCEEDED` (429),
`UNSUPPORTED_TYPE` (400), `FILE_NOT_FOUND` (404 — also returned when the caller has no access).

**Search**

```http
POST /api/v1/ai/search
{ "query": "How much can I spend on accommodation each night?", "limit": 5 }
```
```json
{ "success": true, "data": { "model": "Xenova/all-MiniLM-L6-v2", "results": [ {
  "chunkId": "…", "fileId": "…", "filename": "travel-policy.txt", "mimeType": "text/plain",
  "folderId": null, "chunkIndex": 0, "pageStart": null, "pageEnd": null,
  "snippet": "…Hotel reimbursement is capped at two hundred euros per night…",
  "score": 0.281, "permission": "OWNER" } ] } }
```

**Ask**

```http
POST /api/v1/ai/ask
{ "question": "What is the hotel reimbursement cap?", "fileIds": ["…optional…"] }
```
```json
{ "success": true, "data": {
  "status": "answered",                // or "insufficient_evidence" | "ungrounded"
  "answer": "Hotel stays are reimbursed up to €200 per night [S1].",
  "citations": [ { "ref": "S1", "fileId": "…", "filename": "travel-policy.pdf",
                   "chunkIndex": 2, "pageStart": 3, "pageEnd": 3, "snippet": "…", "score": 0.82,
                   "permission": "VIEWER" } ],
  "sourcesConsidered": 4, "model": "openai:gpt-4o-mini" } }
```

**Document status**

```json
{ "fileId": "…", "status": "ready", "supported": true, "canReindex": true, "error": null,
  "extraction": { "extractor": "pdf-parse/pdfjs", "characters": 18342, "truncated": false, "pageCount": 7 },
  "chunkCount": 19, "embeddingModel": "local:Xenova/all-MiniLM-L6-v2@384", "indexedAt": "…",
  "summary": { "status": "ready", "text": "…", "model": "openai:gpt-4o-mini", "coverage": 1, "error": null },
  "job": { "status": "succeeded", "attempts": 1, "maxAttempts": 3, "nextAttemptAt": null, "lastError": null } }
```

File listings (`GET /files`, `GET /folders/:id/contents`, shared-with-me) include `aiStatus`.

## 4. Frontend

- **File manager / Shared with me / shared folders:** AI status badge (Queued, Indexing, AI ready,
  AI failed), “Document insights” action for supported types, automatic badge refresh while
  indexing.
- **Document insights dialog:** status and errors (including OCR-required), retry / re-index for
  owners and editors, summary (with coverage note), extracted-text preview with “show more”, cited
  passage view.
- **Ask NimbusVault (`/ask`):** grounded Q&A with clickable `[S1]` citations and source cards,
  explicit insufficient-evidence and ungrounded states, semantic search tab, provider-unavailable
  and privacy disclosures.

## 5. Running AI locally

```bash
# local embeddings (no API key, no data leaves the machine)
AI_EMBEDDING_PROVIDER=local
# optional: summaries + Q&A
AI_GENERATION_PROVIDER=openai        # or anthropic
AI_GENERATION_API_KEY=sk-...
```

The worker starts with the API (`AI_WORKER_ENABLED`, default on outside tests). Health:
`GET /api/v1/health/ready` → `checks.ai.{embeddings,generation,worker}`.

## 6. Verification performed

- `tests/ai.unit.test.ts` (20): extraction (PDF pages, DOCX, text/Markdown, OCR-required,
  corrupted, mismatched, invalid UTF-8, limits), chunking determinism/boundaries/pages,
  prompt-injection neutralisation, citation stripping, concurrency limiter, test-double guard.
- `tests/ai.integration.test.ts` (19, real PostgreSQL + pgvector + S3, deterministic provider
  doubles): full lifecycle, cross-user isolation, share/revoke/inherited access, deletion purge,
  model isolation, retries/backoff/permanent failure, idempotent re-index, stale-job recovery,
  insufficient evidence, provider outage, no-provider configuration.
- Live run with the real local MiniLM model through the compiled server and background worker
  (upload → index → paraphrase search → share → revoke → delete).
- **Not verified here:** a real hosted LLM (no API key was available) — Q&A and summary
  generation against OpenAI/Anthropic should be smoke-tested once a key is configured.


## Phase 5 additions

- **OCR** (`ocr.ts`, opt-in): pages rendered with PDF.js, recognised with tesseract.js in-process. English data is bundled; nothing is downloaded and nothing leaves the server.
- **Resilience**: locks are renewed during long jobs; a document that keeps crashing the worker is failed after its last attempt instead of looping; DOCX expansion is measured under a hard cap.
- **Answers** are withheld (`409 SOURCES_CHANGED`) if access to a source is lost while the model is writing.
- **Anthropic**: requests no longer send `temperature` (current models reject it, so every call would have failed) and leave room for adaptive thinking; refusals are reported. The client is a plain HTTP implementation behind the provider interface.
- **Provider errors**: the timeout covers the response body, redirects are refused, and only a short machine code from the provider is kept.
- **Relevance check** (real MiniLM, five representative documents, paraphrased queries): 5 of 5 ranked the right document first; an unrelated query scored nothing above 0.4. This is a smoke check, not a benchmark.
- **Not verified**: summaries and answers from a live hosted LLM (no API key was available).
