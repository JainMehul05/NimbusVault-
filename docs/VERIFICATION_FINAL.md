# Final verification

All observations below are from this laptop on 26 November 2026. Local runtime logs are retained under ignored `.runtime`; sanitized fixture evidence is in this directory. Mock/unit tests and actual native AWS/model/browser checks are distinguished.

## Automated suites

| Suite | Final result | Boundary |
|---|---|---|
| Backend | 293 passed, 12 suites, 86.496 s | Separate PostgreSQL test database and LocalStack; mocked provider failures |
| Frontend | 55 passed, 13 files, 12.94 s | Component/unit tests |
| Python | 68 passed, 26.55 s | Temp databases, real cached MiniLM; real local Qwen grounding and conflicting-policy tests; no AWS |
| Infrastructure | 22 passed, 1 file, 17.81 s | Static tests only, no deploy |
| Original donor Python suite | 46 passed | Earlier preservation baseline |

Backend/frontend production builds, TypeScript source/test checks, ESLint and changed Python Ruff checks passed. Production npm dependency audit reported zero advisories at the observed time. These results do not imply all future dependency versions are safe.

The four suites total **438 passed tests**. The current continuation adds real [60-query search evaluation](SEMANTIC_SEARCH_BENCHMARK.md), [24-question Qwen evaluation](AI_QUALITY_EVALUATION.md), [AWS service acceptance matrix](AWS_ACCEPTANCE_MATRIX.md), deployed-source comparison, actual cold/warm timing and restart persistence. These benchmark and browser cases are separate evidence, not inflated into the automated test total.

## Actual final-application flows

`AWS_REHEARSAL.json` records authenticated multipart upload, native AWS stages, local indexing/completion, original download hash, real single-document Qwen generation, passage opening, two-account isolation, nested inherited sharing/revocation, rename/move/trash/restore, and restored idle state. Single-document answer took 12.182 s including 10.384 s model load; retrieval was 58.36 ms.

`LOCAL_RAG_ACCEPTANCE.json` records real two-document Qwen generation with both citations, follow-up answering the synthetic number 914, unsupported-question abstention, actual cancellation returning 499 without completed history, successful next generation, history removal after share revocation, owner-only dashboard statistics, wrong-password rejection and immediate logout invalidation. Retrieval for the two-document answer was 43.2 ms; timing detail separates generation/loading/correction. The actual Python conflicting-policy test generated North 30 days and South 90 days with the correct distinct passages; its output is retained privately under `.runtime/conflicting-policies-acceptance.json`.

The browser harness used the installed Brave browser through Playwright. It passed 54 direct-route/viewport checks across 360, 390, 768, 1024, 1366 and 1920 pixels, with no horizontal overflow. Actual workflows passed sign-in, folder creation, nested file navigation, generated Ask, clickable citation, browser original download with SHA256 equality, history reopening and administrator cloud diagnostics; zero page errors. Screenshots and browser report remain private under `.runtime` because live UI may contain user information.

Final focused browser checks at 360, 390 and 1366 pixels also passed real owner-only dashboard charts and the selected-document Ask scope badge, with zero page errors. After safe service restart, `AWS_PAUSED_ACCEPTANCE.json` proves exact local cached search and real generated answers work with cloud operations disabled, while downloads fail closed with 503. `MODEL_UNAVAILABLE_ACCEPTANCE.json` proves stopping only the recorded owned Ollama process produces a cited extractive answer while search continues. Configuration, models and application services were restored and warmed afterward. No cloud mutations were used for these failure-mode checks.

Native API/IAM, SSM, logs, metrics and optional fixed-vector demonstration have separate actual evidence files. No cloud API was simulated for those records. The preservation audit found all 12 legacy originals and all 61 original vectors intact. Routine query tests use local embeddings and explicitly assert zero AWS calls.

## Failures found and fixed

- Inherited tests assumed LocalStack port 4566; endpoint assertions now use configuration for the isolated port 4567.
- A short or multi-topic embedding query could miss a rare technical clause. Bounded clause retrieval and scoped lexical rescue improved multi-topic coverage. It remains possible to get no result for a poorly phrased query; exact search is available.
- Qwen invented a purpose relation from adjacent statements. Validation rejects that relation. It also mixed up source numbers despite exact quotes; only unique authorized exact quotes can align an existing label. Fabricated IDs remain invalid.
- One correction discarded a previously valid numeric claim. Verified-claim merging now preserves it without accepting rejected claims.
- A static-asset rate limiter broke browser navigation; rate limiting now applies to API routes.
- Browser full navigation interrupted refresh rotation in the first harness. The harness waits for completion; authentication was not weakened.
- First cold Qwen run timed out. Warmup and visible extractive fallback are retained; warm and real subsequent runs passed. A build/restart overlap during verification caused a transient missing compiled module; build and restart must be sequential.

Rejected model answers are retained in `verification-history`. They are evidence of the repair process, not successful generated answers. The final two-document pass preserves the same challenging question and two-source assertion. Fallbacks are never relabeled as generated.

Continuation repairs also cover current filenames after rename, exact technical identifiers, RRF date ties, ordinary claim inflections, changed security triggers, unsupported purpose additions and omitted explicit topics. Restarting disposable LocalStack removed its test bucket and caused an honest failed full-suite run. `scripts/test-backend-local.ps1` now recreates only that localhost test bucket and verifies the isolated test database; the complete293-test rerun passed without weakening assertions.

## Practical limits

No OCR, standalone summary generation, permanent purge, paid AI, hosted deployment or new AWS infrastructure is enabled. Supported text extraction is bounded (25 MiB uploads, configured character/chunk limits). GPU observations were from the RTX 4050 6 GiB; Qwen used approximately 2.33 GiB VRAM, with 6,144 context configuration and single generation concurrency. The local model has finite accuracy; citations and conservative validation help, but do not establish formal semantic truth. Highly paraphrased questions can abstain or fall back. Cold latency and memory pressure vary. Large-scale, adversarial and load benchmarks were not performed.

Cloud controls remain dependent on current AWS account state; observed Free-plan status is not a future spending guarantee. Downloading originals needs cloud availability, while cached local retrieval/answers do not. Test scripts that mutate cloud state must not be replayed without approval. Private user documents were excluded from all synthetic evaluation scopes.
