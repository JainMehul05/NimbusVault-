# Groq Cloud integration — model selection and 40-case evaluation

Fresh measurements, 27 Nov 2026, run on the Windows laptop through the unchanged harness (`scripts/benchmark-ai.py`, same 40 frozen cases, same pass rule) with `LLM_PROVIDER=groq`, Qwen fallback **disabled** (so every generated answer is Groq's), and the synthetic benchmark corpus explicitly cleared for external processing. MiniLM retrieval, BM25/hybrid, citation alignment, quotation validation and bounded correction are the existing NimbusVault pipeline.

## Model discovery and selection
Models API for this key (Free plan): `openai/gpt-oss-20b`, `openai/gpt-oss-120b` (production), `qwen/qwen3.8-27b` (preview), plus speech/guard/safeguard/4k-context models unsuitable for RAG. Free limits (Groq docs, per organization): gpt-oss 30 RPM · 1K RPD · 8K TPM · 200K TPD.

| Candidate (12-case representative subset) | Pass | Corrections | Median end-to-end | Provider call | Tokens / request |
|---|---|---|---|---|---|
| **openai/gpt-oss-20b** (production) | 12/12 | 0 | **0.96 s** | 0.79 s | ~1,145 |
| openai/gpt-oss-120b (production) | 12/12 | 1 | 1.34 s | 1.11 s | ~1,139 |
| qwen/qwen3.8-27b (preview) | 12/12 | 0 | 0.96 s | 0.69 s | ~994 |

Selected **openai/gpt-oss-20b**: equal accuracy, fastest production model, no corrections, modest tokens. Qwen3.8 is preview ("should not be used in production"). Configurable via `GROQ_MODEL`.

## Full 40-case result (gpt-oss-20b, reasoning_effort=low, strict JSON schema, temperature 0)
| Measure | Groq gpt-oss-20b | Qwen2.5 3B EC2 CPU (Session A) | Qwen2.5 3B Windows GPU |
|---|---|---|---|
| Strict passes | **40/40** | 40/40 | 40/40 |
| Genuine generated (answerable) | **31/31 (all Groq)** | 31/31 | 31/31 |
| Correct abstentions | 9/9 | 9/9 | 9/9 |
| Quotation / permission failures | 0 / 0 | 0 / 0 | 0 / 0 |
| Median latency (all cases) | **1.24 s** | 28.1 s | ≈1.5 s warm (historical) |
| p95 latency | **3.6 s** | 63.6 s (generated p90) | — |
| Median generated answer | 1.54 s | 30.2 s | — |
| Provider requests / corrections | 36 / 3 | — | — |
| Tokens (prompt / completion / reasoning) | 35,543 / 3,590 / 719 | local | local |
Speed-up vs. the EC2 CPU Qwen median: ≈ **23×** (fresh Groq vs. historical EC2 measurement; equivalent questions and context). Latency excludes the 480 s of deliberate pacing waits imposed by the app's per-minute token budget.

## Limits and behaviour
App budgets below Free limits (20 req/min, 6,000 tokens/min, 400 req/day, 120,000 tokens/day, 40 questions/user/day) are persisted in the intelligence SQLite database and enforced before every provider request, including corrections and ambiguous network failures. 429 honours `retry-after` with a cooldown; 401/403 stop requests for 15 min; 5xx/network retried once. With the 8K TPM Free limit, sustained throughput is about 5 questions/minute for the whole site.

Raw evidence (private): `.runtime/groq/groq-40-gpt-oss-20b.json`, `.runtime/groq/candidate-*.json`.
