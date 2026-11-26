# Measured local search evaluation

> Independent audit update (27 November 2026): Latest independent evaluation:84 queries (69 positive/15 negative), hybrid69/69 top1 and15/15 correct negatives; dense65/69 top1; genuine BM2564/69 top1 and8/15 negatives. Separate13/13 mode-specific checks passed. [Current results and precision/recall tradeoff](INDEPENDENT_AUDIT_REPORT.md#search-evaluation) supersede historical results below.

All fixtures are non-sensitive and local-only. No benchmark document was uploaded to AWS and no AWS vector queries were made. The same cached MiniLM model, normalization and 384D pipeline were used throughout. Canonical extraction/indexing and the private search adapter ran against a temporary database, never the live runtime or donor database.

## Method

`benchmarks/corpus.json` fixed 17 documents and 50 judgments before tuning. Eight queries were designated tuning and 42 initial held-out. After the initial results, two held-out failures were investigated as implementation defects; final results on those original 50 are therefore development evaluation, not untouched hold-out performance. A separate ten-query set in `benchmarks/fresh-held-out.json` was defined after those repairs and evaluated without further tuning. Final evaluation totals 60 queries: 54 positive and six negative. Permissions are represented by trusted synthetic file-ID scopes; actual Express folder/permission derivation is tested separately in integration/browser acceptance.

Each query runs in semantic and hybrid modes. Metrics use unique document ranks; Recall@3 counts all expected complementary documents. Negative queries are scored separately. Cosine values are ranking inputs, never model accuracy percentages. Relevance labels have not been changed to accommodate returned results.

## Results

| Measurement | Initial 50-query hybrid baseline | Final 60-query hybrid | Final 60-query semantic |
|---|---:|---:|---:|
| Positive queries | 46 | 54 | 54 |
| Top-1 relevant document | 95.65% | 100% | 96.30% |
| Top-3 success | 97.83% | 100% | 98.15% |
| Mean Recall@3 | 96.74% | 99.07% | 97.22% |
| MRR | 0.9674 | 1.0000 | 0.9722 |
| Correct negative abstentions | 3/4 | 5/6 | 5/6 |
| Unauthorized document leaks | 0 | 0 | 0 |
| Median request latency | 10.45 ms | 12.65 ms | 20.09 ms |
| P95 request latency | 14.69 ms | 18.27 ms | 28.60 ms |

The fresh ten-query set produced 8/8 top-1 positive hits and 2/2 correct abstentions in both modes. These are small curated samples, not a claim of perfect general semantic accuracy. Baseline and final sample counts differ; compare the common 50-query cases in the JSON files for paired analysis. Query-vector caches, CPU/memory load and test ordering affect latency; these are local adapter timings, not guaranteed browser response times.

## Actual defects repaired

- The exact earlier phrase **“MiniLM Qwen local laptop”** was replayed against the unchanged 242-byte approved canary and baseline Git revision `8d07eda`. Before: zero results. After: one correct result. Cosine was only 0.1773, so the original dense-dependent lexical rescue rejected four exact anchors. Hybrid now permits complete scoped BM25 term coverage independently of dense similarity for a short query. Dense-only threshold remains 0.28. See `RECOVERED_QUERY_REGRESSION.json`.
- A single exact identifier such as `NV-409` was lost under dense relevance gating. Hybrid now preserves an exact letter/number identifier anchor without requiring it to embed like prose. Scope filters still apply before ranking.
- Equal reciprocal-rank-fusion scores retained dense order, losing the distinguishing January date match. Lexical coverage then similarity now resolve RRF ties.
- Logical rename left SQLite's cached filename stale. Filename matching receives current authorized PostgreSQL names. Exact and filename SQL also filter the trusted file scope before reading candidate chunks.
- Smart Search groups passages into distinct file results; RAG retains complementary passages. The UI now exposes actual nested folder/type filters, selected-file scope, result counts, mode explanations and measured server time.

## Remaining limitations

The query asking for the confidential Cedar budget retrieves the authorized Cedar release document because of topical similarity, although it contains no budget. The unauthorized budget document is excluded, and the actual Qwen test correctly abstains. This is one false-positive search result, not a data leak or a supported answer. One multipart query does not recover every expected file within the first three, reflected in Recall@3 below 100%. Semantic-only mode still struggles with an exact identifier and a near-identical date-policy ranking. Hybrid/exact modes serve those use cases explicitly.

Long-document end passages, synonyms, abbreviations, dates/numbers, selected/folder scopes and unrelated questions are represented. There is no large-corpus, multilingual or adversarial retrieval benchmark. See `SEARCH_BENCHMARK_BASELINE.json`, `SEARCH_BENCHMARK_FINAL.json` and retained repair evidence. Reproduce locally with:

```powershell
& intelligence/.venv/Scripts/python.exe scripts/benchmark-search.py --label final --fresh-held-out
```
