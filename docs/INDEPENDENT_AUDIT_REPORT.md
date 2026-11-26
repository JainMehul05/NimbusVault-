# NimbusVault independent quality audit

Completed 27 November 2026 (Asia/Kolkata). Evidence timestamps use UTC. This audit continues the existing NimbusVault application from checkpoint `5268137`; it does not replace the project or repeat an AWS write rehearsal. The new challenge judgments were committed before tuning (`7355c7f`); implementation checkpoint `4961a99` preserves the main repairs. Run `git log -1` for the final handover checkpoint. Nothing was pushed or deployed.

## Run the project

Directory: `C:\Users\hp\Downloads\nimbus vault final`. Application: **http://127.0.0.1:3100**. Branch: `codex/nimbusvault-integration`.

With Docker Desktop running, execute these commands in that directory:

```powershell
npm start
npm run warmup
# After use:
npm stop
# Before maintenance:
npm run backup
```

The application and local model were restored after testing. Startup performs no cloud deployment or consumer enabling. Private configuration, credentials, runtime documents and backups remain excluded from Git. Use `npm run setup` only for initial setup/dependency repair. Never reset the final runtime database: it includes a private user document as well as synthetic fixtures.

## Defects found and repaired

* Topic-name similarity could return a release passage for an absent price, budget, telephone or address. Scoped, source-derived subject/facet checks now require evidence for the requested attribute. Exact technical identifiers must be supported literally.
* Pure semantic retrieval had a keyword threshold rescue. Dense mode now remains dense-only; independent BM25 retrieval does not load or encode with the embedding model. Hybrid retains scoped fusion and complementary-source recovery. Literal and BM25 badges no longer imply cosine confidence.
* The two original strict summary failures omitted supported facts. A bounded excerpt-summary prompt, explicit coverage checks and one source-faithful model correction repair those omissions. The correction is decoded by Qwen; invalid output is not relabeled as generated, and fallback remains explicit.
* Multipart omissions within one source and cross-source subject/value mismatches could evade validation. Coverage now checks these cases; named-party attribution rejects a real quotation attached to the wrong policy. Previous summary questions no longer select summary mode for a factual follow-up.
* Primary/private file-scope limits differed. Both now enforce 250 indexed documents, with a clear error rather than silently truncating scope.
* Source mapping hid unexpected database errors as absent sources. Only revoked/missing source errors are suppressed; other failures propagate.
* Cloud completion could be requested by an infrastructure administrator with viewer-only document access. It now requires document write permission.
* Changing scope could attach a late response to the wrong conversation. Scope epochs guard late responses; history/new-conversation/continuation controls cannot switch conversations during generation.
* The Stop harness used an unsupported question that finished with abstention in 37.68 ms before its fixed 200 ms delay. The failed evidence is retained. The repaired harness uses a supported question, observes the authenticated private busy state, then requires HTTP499, no completed history and a successful next generation. This was a harness defect, not proof of a decoder cancellation failure.

## Search evaluation

The corpus and expected relevance judgments remain fixed. There are 60 earlier queries plus 24 new challenges: 69 positive and 15 negative queries. The new cases were frozen before tuning, but were subsequently used to diagnose repairs; they are no longer an untouched statistical holdout. No private user documents entered this benchmark. Local evaluations made zero AWS calls.

| Final mode, 84 queries | Positive top-1 | Positive top-3 | Mean Recall@3 | MRR | Correct negative abstentions | Unauthorized results |
|---|---:|---:|---:|---:|---:|---:|
| Hybrid | 69/69 | 69/69 | 98.55% | 1.0000 | 15/15 | 0 |
| Pure semantic | 65/69 | 66/69 | 94.20% | 0.9493 | 15/15 | 0 |
| BM25 keywords | 64/69 | 66/69 | 95.65% | 0.9396 | 8/15 | 0 |

Hybrid median/p95 retrieval: 12.285/18.03 ms. Semantic: 21.595/41.99 ms. Final BM25: 6.35/12.24 ms. These are small local corpus measurements, not internet or large-corpus SLAs. BM25 intentionally returns literal keyword matches and is weaker for missing-attribute questions; select Hybrid for grounded questions. Pure semantic remains weaker on exact identifiers.

The same 84-query hybrid baseline had 69/69 positive top-1 but only 9/15 correct negatives. Final negative errors fell from six to zero; mean Recall@3 fell slightly from 99.28% to 98.55%. This precision/recall tradeoff is reported explicitly. Separately, 13/13 mode-appropriate filename, literal, BM25, semantic and hybrid checks passed on newly created isolated fixtures, including private-document exclusion and stable passage identity after reindexing.

Evidence: [final hybrid/semantic](SEARCH_BENCHMARK_INDEPENDENT-FINAL.json), [baseline](SEARCH_BENCHMARK_INDEPENDENT-BASELINE.json), [BM25](SEARCH_BENCHMARK_INDEPENDENT-LEXICAL.json), [individual modes](INDEPENDENT_SEARCH_MODES.json).

## Actual Qwen generation and grounding

| Frozen evaluation | Strict acceptance | Genuine generated positive answers | Correct abstentions | Mean rubric fact coverage | Quote/scope failures |
|---|---:|---:|---:|---:|---:|
| Original 24 questions | 24/24 | 19/19 | 5/5 | 100% | 0/0 |
| New 16 challenges | 16/16 | 12/12 | 4/4 | 100% | 0/0 |

The previous release was 22/24 strict on the original questions; the initial new challenge baseline was 11/16. Final medians were 1,538.25 and 1,710.31 ms respectively. Actual Qwen outputs, exact supporting quotations, facts and scope judgments are retained in [original final answers](INDEPENDENT_ORIGINAL_AI_FINAL.json) and [new final answers](INDEPENDENT_AI_FINAL.json). Intermediate failures remain in `verification-history` and the baseline files. These results establish acceptance on these synthetic excerpts, not arbitrary-document correctness. Some model corrections copy complete supported source sentences; no extractive fallback is counted as model generation.

Real final-application checks also passed two-document generation, follow-up, unsupported-question abstention, active Stop, released generation slot, revoked history, private statistics and logout invalidation: [local flow evidence](LOCAL_RAG_ACCEPTANCE.json).

## AWS service-by-service evidence

The single previously approved native rehearsal remains the actual final-application write evidence. This independent audit performed read-only diagnostics, source/configuration comparisons, metrics and a bounded log sample. It did not replay uploads, enable consumers, mutate IAM, deploy code, delete objects or consume the historical DLQ message. One broad-audit Step Functions request timed out; the later detailed audit succeeded, and a final targeted guarded DescribeStateMachine recheck confirmed ACTIVE at2026-11-26T18:43:43Z. The dashboard snapshot was refreshed and the original timeout was preserved in `verification-history/step-functions-prior-timeout.json`.

| Existing service | Verified purpose and evidence | Current boundary |
|---|---|---|
| S3 | Final-app synthetic uploads and original-byte download/hash proof; all legacy keys still present | Private originals; no new audit upload |
| DynamoDB | Native workflow metadata and local completion records | Application permissions remain in PostgreSQL |
| Lambda | Native event dispatch/stages; deployed code hash and source package audit | Existing deployed version retained |
| EventBridge | Native S3 event routing in approved rehearsal | Restored DISABLED |
| SQS | Native queue/Lambda dispatch, bounded configuration | Consumer mapping Disabled; source queue empty |
| SQS DLQ | Existing redrive/retention configuration and historical evidence | One historical message preserved; no new poison-message rehearsal |
| Step Functions | Four succeeded and one failed historical execution; native awaiting-local boundary | No running executions; local completion is outbound reconciliation |
| CloudWatch | Real execution logs, bounded metrics and five-event log safety sample | Historical/windowed evidence, not continuous monitoring |
| API Gateway | Signed status accepted, unsigned status denied; IAM/throttle configuration | Global cloud lists not exposed to ordinary users |
| S3 Vectors | Prior final-app restricted synthetic QueryVectors evidence | Optional fixed demonstration; default local search/Ask make zero vector calls |
| Parameter Store | Three existing Standard parameters match active configuration | No parameter writes or per-query lookup |
| CloudFormation | Existing deployed resource relationships inspected | No deployment or stack modification |
| IAM / STS | Existing identity, trust and scoped policies inspected | No policy changes; infrastructure admin grants no document ownership |

Full statuses, evidence types and missing-live-test qualifications: [AWS matrix](AWS_ACCEPTANCE_MATRIX.md), [structured matrix](AWS_ACCEPTANCE_MATRIX.json), [read-only audit](AWS_DETAILED_READ_AUDIT.json), [native rehearsal](AWS_REHEARSAL.json), [deployed source](DEPLOYED_SOURCE_AUDIT.json), [log sample](INDEPENDENT_LOG_SAFETY.json).

At 2026-11-26T18:02:54Z, the existing account was **FREE / ACTIVE**, with **USD139.998443** credits, expiry **24 May 2027**, and the USD1 reserve guard passed. The app's later browser refresh also exercised the current guard. No paid plan, new AWS resources, paid AI provider or billing upgrade was introduced. Financial requirement remains ₹0 out-of-pocket; the fail-closed guard and paused consumers reduce exposure but are not a hard AWS billing cap or guarantee about all account activity. Further cloud mutations/rehearsals require fresh approval and a passing current guard. An expired login/plan or failed reserve must keep cloud access blocked.

## Reliability, browser and security

Three actual model-cold and three immediate warm requests passed after a full stop/start. Model-cold median/slowest: **6,856/7,019 ms**; warm median/slowest: **1,544/1,544 ms**. Concurrent file-management requests took **21–40 ms**; account, indexed fixture and original conversation survived restart. This unloads the owned model, not the operating-system disk cache. Six samples do not establish long-running leak freedom. [Repeated performance](INDEPENDENT_RUNTIME_PERFORMANCE.json).

The actual cloud-disabled app retained local generation/search while original download correctly returned503. With Ollama stopped it returned explicit cited extractive fallback; settings/services were restored. Authentication was not deliberately expired again: historical LoginRefreshRequired and guard error tests are separately labeled. [Cloud paused](AWS_PAUSED_ACCEPTANCE.json), [model unavailable](MODEL_UNAVAILABLE_ACCEPTANCE.json).

A redundant browser rerun exhausted the existing120-refresh/15-minute limiter after earlier full and focused reload suites. A direct probe confirmed429/Retry-After; the failed run is retained in `verification-history/independent-browser-refresh-window.json`. Only the owned application services were restarted and the full suite rerun from a fresh window. No rate limit was increased or bypassed. Rapid repetitive reloads can legitimately require waiting before sign-in/session refresh.

Automated suites: **296 backend +57 frontend +74 Python +22 infrastructure =449 passed**, counted separately from benchmarks/browser. Production build, TypeScript, ESLint and Ruff passed. Browser: **54 responsive route checks +7 real workflows**, no page errors; focused 360/390/1366 layouts, nested folder/type filters, summary prefill, themes, mobile navigation and real BM25/literal badges passed. Five access-boundary probes returned the expected401/403/404. [Test report](INDEPENDENT_TEST_RESULTS.json), [browser evidence](INDEPENDENT_BROWSER_ACCEPTANCE.json), [focused UI](FINAL_UI_ACCEPTANCE.json), [access checks](ACCESS_BOUNDARY_ACCEPTANCE.json).

Existing production npm audit reported zero advisories; the Python scan reported zero known advisories for 75 packages but skipped CPU-specific Torch. The alternative review checked Torch2.15.0+cpu against its base-version OSV advisory mapping, confirmed the version on the official CPU index, and verified **12,357 installed RECORD hashes**, with no mismatches. No dependency was upgraded. RECORD consistency is not signed provenance; base-version advisory lookup is not a CPU-build code audit. [Dependency scan](DEPENDENCY_SECURITY_AUDIT.json), [Torch review](TORCH_ALTERNATIVE_REVIEW.json).

Private-service authentication and actor/scope validation cover the new busy endpoint. Prompt injection has no tools; exact quotation, numeric/content and named-party checks constrain answers. Source scans exclude runtime data and report paths rather than secret values. Five sampled CloudWatch events contained no flagged sensitive fields; this is a bounded sample, not a universal log-privacy certification.

## Preservation and limits

Original CloudVault tree/configuration unchanged: **12 files, 61 chunks/vectors, 21 conversations, 32 exchanges**, byte/row-equivalent to the initial backup. Cloud originals and original vector payloads passed read-only preservation checks. Two synthetic rehearsal documents and a separate private user PDF are additions in the final runtime; they are not reassigned legacy documents. Existing backups and model caches were retained. Final private backup validates PostgreSQL archive readability and SQLite integrity. [Local preservation](PRESERVATION_LOCAL_AUDIT.json), [cloud preservation](PRESERVATION_CLOUD_AUDIT.json), [source safety](SOURCE_SAFETY_AUDIT.json).

Remaining limits are deliberate and visible: small synthetic evaluation corpus; local 3B model variability; summaries cover retrieved excerpts, not entire large documents; single model concurrency; bounded 250-file scope; keyword false positives in BM25; no OCR guarantee for scanned images; no new DLQ/failure injection or additional-format live cloud rehearsal; optional cloud vectors remain a restricted synthetic demonstration; no cloud billing hard cap; hardware-specific latency; redistribution/license questions documented in the handover. No claim of universal100% reliability is made.

## Dependable demonstration

1. Start and warm the app; sign in and show actual dashboard statistics.
2. Create a local folder. For a demonstration today, reuse the already verified synthetic original; a new live upload is a cloud mutation and requires fresh approval. The UI upload flow exists and its actual native rehearsal evidence is retained.
3. Open Ask scoped to that document. Search `MiniLM Qwen local laptop` in Hybrid; compare Semantic, BM25 and Exact. Explain their different scores and purposes.
4. Ask `Where do MiniLM embeddings and Qwen answer generation run?`; show generated mode and open its supporting citation.
5. For a two-document demonstration, share only the known synthetic Borealis fixture through its owner account, ask the local-processing/access-number question and a follow-up, then revoke that temporary share. Do not share the private PDF.
6. Download the synthetic original and explain the recorded SHA256 proof. Open Cloud Infrastructure: distinguish current read-only guard/configuration observations from dated native workflow/CloudWatch evidence.
7. Explain S3→EventBridge→SQS→Lambda→Step Functions→DynamoDB, then the local MiniLM/Qwen boundary. Describe the optional restricted AWS-vector demonstration using its retained actual evidence; do not rerun it as part of ordinary local search.
8. Keep rule/consumer paused after demonstration. Use the service matrix and [viva guide](EVALUATION_AND_VIVA.md) for evidence qualifications.
