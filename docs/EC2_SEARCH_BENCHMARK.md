# EC2 search benchmark (84 queries)

Run 27 Nov 2026 09:41 UTC inside the EC2 intelligence container (`scripts/benchmark-search.py --label ec2-session-a --fresh-held-out --independent --modes semantic hybrid lexical`). Dataset, judgments and evaluator unchanged; isolated temporary data directory; SDK tripwire recorded **0 AWS calls**. 69 answerable + 15 negative queries. Model sentence-transformers/all-MiniLM-L6-v2 (384-d). Regression evidence, not an untouched hold-out.

| Mode | Top-1 | Top-3 | Recall@3 | MRR | Negatives rejected | Unauthorized | Median ms | p95 ms |
|---|---|---|---|---|---|---|---|---|
| Hybrid (default) | 69/69 | 69/69 | 98.55 % | 1.000 | 15/15 | 0 | 6.78 | 8.13 |
| Dense semantic | 65/69 | 66/69 | 94.20 % | 0.949 | 15/15 | 0 | 20.24 | 34.34 |
| BM25 | 64/69 | 66/69 | 95.65 % | 0.940 | 8/15 | 0 | 3.06 | 3.31 |

Identical accuracy to the Windows baseline and the local Linux run; EC2 retrieval latency is lower than the historical Windows figures (hybrid 12.3/18.0 ms). Whole run: 14 s.

Application-level checks on EC2 with new uploads (64/64 suite): filename, exact phrase, BM25, semantic paraphrase, hybrid multi-document, folder filter, other user's private document excluded, revoked share removed, trashed file removed and restored, search without the LLM, search with cloud paused. Raw: `.runtime/aws-deployment/search-84-ec2-session-a.json`.
