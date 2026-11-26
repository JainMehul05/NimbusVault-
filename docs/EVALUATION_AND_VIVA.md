# Evaluation and viva notes

> Independent audit update (27 November 2026): Latest evidence:[independent audit and demonstration](INDEPENDENT_AUDIT_REPORT.md). Explain why perfect acceptance on40 synthetic cases is not universal model reliability; why BM25 has7 negative-query matches; why hybrid trades a small amount of complementary recall for precision; why current configuration observations differ from dated native workflow evidence; and why a credit guard is not a hard AWS billing cap.

## Demonstration sequence

1. Show the actual NimbusVault landing page, register/sign in, dashboard and account controls at the single local URL.
2. Explain an indexed, non-sensitive fixture: immutable private S3 original; PostgreSQL ownership; local extracted chunks and normalized 384D vectors.
3. Demonstrate exact versus semantic/hybrid search, then Ask. Open each cited passage and download the original. Point out Generated versus Extractive fallback labels.
4. Ask an unsupported question and show abstention. Use Stop and show that the canceled generation does not become completed history.
5. Share a synthetic file to a second account, verify inherited access, revoke it and show revoked history/citations are unavailable.
6. Show cached administrator cloud evidence and restored idle states. Do not enable consumers, upload more cloud fixtures or replay a live rehearsal as part of a presentation without new approval.
7. Explain the preserved unassigned donor corpus and the distinction between mocked tests, real model/browser tests and native AWS evidence.

## Questions and concrete answers

| Question | Answer |
|---|---|
| Why both PostgreSQL and SQLite? | Preserve NimbusVault's relational accounts/permissions while reusing the canonical local CloudVault extraction/retrieval/history implementation in an independent database. |
| Why not send every query to AWS vectors? | The requested default is private local search and zero out-of-pocket cost; MiniLM and local ranking need no cloud API. Cloud vectors are a separate restricted demonstration. |
| How is cross-user leakage prevented? | Authenticated account scope resolves before retrieval; source and whole-answer permissions are checked again, including historical responses and revocation. |
| Why validate quotations? | Small local models can invent relationships or mislabel sources. Exact quotation, numeric/content checks and bounded correction reject unsupported claims; fallback is explicit. |
| What does local AI actually use? | Cached sentence-transformers/all-MiniLM-L6-v2 on CPU, 384D normalized vectors; local Ollama Qwen2.5:3b Q4_K_M, single concurrency. No paid generation provider is selected. |
| Does a green build prove AWS worked? | No. The separate native rehearsal records actual final-app upload, service transitions, local completion and hash equality. Tests with LocalStack are labeled separately. |
| Why is permanent delete disabled? | Preserve original cloud content within the approved non-destructive scope. Trash/restore changes application visibility without deleting original bytes. |
| How is spending bounded? | Existing resources only, verified account/active Free plan/reserve guard, paused consumers, bounded manual diagnostics and local default AI. No upgrade or guard bypass is permitted. |
| What remains limited? | OCR, standalone summaries, cloud purge, deployment, high-concurrency/large-scale evaluation and semantic correctness guarantees are outside this local integration. |

## Evaluation interpretation

The automated suites establish regression and access boundaries; they are not a published retrieval benchmark. The two-document synthetic case and conflicting-policy case establish real local grounded behavior, not general factual accuracy. Latencies include model load and bounded correction where recorded. Failed and fallback model outputs are preserved transparently rather than counted as successful generation. The original corpus was not reassigned or used as an implicit evaluation dataset.

Expanded measured evaluation is now available in [search](SEMANTIC_SEARCH_BENCHMARK.md) and [Qwen quality](AI_QUALITY_EVALUATION.md). Present the actual60-query and24-question results with their negative/partial cases, not a claim of universal100% accuracy. The [AWS matrix](AWS_ACCEPTANCE_MATRIX.md) explains why a paused native consumer and historical DLQ redrive are distinct from currently running processing. For an unavailable-model demo use the retained actual fallback evidence; do not kill a shared runtime during presentation. For AWS unavailability use cached local search/Ask and explain that original download needs cloud availability.
