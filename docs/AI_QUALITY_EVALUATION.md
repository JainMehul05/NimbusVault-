# Real local Qwen evaluation

> Independent audit update (27 November 2026): The independent audit repaired the two excerpt-summary coverage gaps. Current actual Qwen acceptance:original24/24 (19 generated,5 abstained), new16/16 (12 generated,4 abstained), zero tested quote/scope failures. One bounded source-faithful Qwen correction remains; excerpt coverage is not whole-document completeness. [Current evidence and limits](INDEPENDENT_AUDIT_REPORT.md#actual-qwen-generation-and-grounding). Earlier failures below remain historical evidence.

The fixed benchmark contains 24 questions over the synthetic local corpus. Nineteen require answers; five require abstention, including unauthorized/empty scope, unavailable information and an instruction to reveal a token. All principal answer cases use actual Ollama Qwen2.5:3b Q4_K_M inference, not mocked responses. Each run indexes into a temporary database; no user documents, cloud uploads or AWS requests are involved.

`AI_QUALITY_BASELINE.json` retains the first complete run: 18/24 strict acceptance, 17/19 generated positive answers, 81.58% literal expected-fact coverage, 4/5 correct abstentions. The final `AI_QUALITY_BENCHMARK.json` records **22/24 strict acceptance**, **19/19 genuinely generated positive answers**, **96.49% expected-fact coverage**, **5/5 correct abstentions**, **zero exact-quotation failures** and **zero permission-scope failures**. Median total request time in that run was 1.747 seconds. Source/citation identity, exact supporting quotations, expected facts and document coverage are checked separately. Literal fact matching is a useful rubric, not a complete semantic-quality metric.

Final real generation covers single facts, numeric/date values, technical mechanisms, exact error codes, two-document comparisons, contradictory retention policies, multipart multi-document questions, pronoun follow-ups and the emergency instruction at the end of a long document. The long-document answer correctly names the western assembly point and coordinator Laila Chen. All displayed claims/citations in the 24-case report were reviewed against the supplied synthetic passages; the automated source checks are not treated as a mathematical proof of entailment.

## Improvements driven by actual outputs

- Distinct facts sharing one quotation were incorrectly deduplicated during correction. Claim merging now retains distinct verified facts.
- Ordinary inflections such as target/targets and annual/annually caused valid claims to fail content-word checks. Limited lexical normalization fixes this while exact quotes, numbers and semantic thresholds stay unchanged. Wrong numbers still fail.
- Reusing versus revoking a token changes the triggering event. The validator now rejects that change and unstated security-purpose elaboration.
- Contradictory `insufficient=true` plus nonempty claims receives one bounded correction rather than silently treating the malformed contract as an answer.
- Selected-document summaries use bounded retrieved excerpts even when the summary instruction itself has low cosine similarity. They are explicitly excerpt summaries, not claims to have read an entire long document.
- Evidence preserves exact original passages for validation; duplicate sentences are removed only from model presentation, and relevant sentences plus explicit user-topic hints help the small model cover complementary evidence.
- Missing explicit multipart topics or short-excerpt controls can trigger the existing single correction. If coverage remains incomplete, a visible supported-partial warning is returned. No endless retry loop was introduced.
- Model instructions reinforce absent-attribute abstention and require source words rather than unsupported filler. Source IDs, quotes, numbers and current permissions remain independently validated.

## Remaining shortfalls

Two final excerpt-summary cases are supported but incomplete: the backup summary omits the Sunday schedule, and the session-control summary omits password hashing. Both carry the supported-partial warning and fail the strict benchmark rubric; they are not counted as complete summaries. Original passages remain clickable. Qwen can still omit requested details or produce a rejected paraphrase. The system returns bounded corrections, partial output, abstention or labeled extractive fallback rather than inventing a successful answer.

The benchmark was used for development, so these are acceptance results, not held-out general intelligence claims. Rejected generations and intermediate regressions are preserved under `verification-history`. Raw model outputs there are explicitly unaccepted diagnostic material. No unsupported response was relabeled as successful generation.

## Actual application performance and resilience

`RUNTIME_PERFORMANCE_ACCEPTANCE.json` verifies the final application's persistent account, indexed fixture and original rehearsal conversation after restarts. After explicitly unloading only the recorded owned model: cold answer 8.551 s, including 6.163 s model loading; warm answer 1.857 s, model loading 0.012 s. Retrieval was 67.03 ms cold-run /18.40 ms warm-run; concurrent file-management requests completed in 32/26 ms. This is one controlled pair, not a distribution or performance guarantee. The first primary embedding load in browser scope testing took about 11.9 s; warm adapter search is much faster. Warmup is explicit.

Actual model-stopped fallback and AWS-disabled local generation/search passed in separate reports. Actual Stop returned 499, saved no completed canceled exchange and released the slot. Two-account/history revocation passed through the primary app. There is no paid inference provider, remote tool execution or model-driven cloud mutation.

Reproduce the synthetic benchmark with `intelligence/.venv/Scripts/python.exe scripts/benchmark-ai.py`; it makes 24 bounded local requests and can take several minutes on a cold or memory-constrained laptop.
