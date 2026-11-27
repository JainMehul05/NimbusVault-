# EC2 performance report — m7i-flex.large (2 vCPU, 7.6 GiB usable, CPU only)

All values measured 27 Nov 2026 on instance i-0569d222e63fc7f36. "Via tunnel" includes ≈0.4 s SSM round trip from the laptop.

## Startup (cold levels)
| Level | Measurement |
|---|---|
| Instance stop (graceful, verified `stopped`) | 31 s |
| Instance start → OS ready | kernel 1.05 s + userspace 29.9 s = 31.0 s |
| `npm run aws:start` → SSM online + app health | 40 s |
| Embedding-model cold: first semantic search after boot | 11.5 s (MiniLM import/load/encode; local Linux measured ≈6.7 s for load+encode) |
| LLM cold: first answer after boot | 70.7 s (Qwen 1.9 GB loaded from gp3 + generation) |
| `npm run aws:warmup` (loads both) | 20 s; first deploy warmup with page-cached model 7.9 s |
| Warm answer (short) | 31 s via tunnel |
| Warm semantic search | 0.5 s via tunnel; server-side hybrid median 6.8 ms / p95 8.1 ms |

## Generation
Qwen2.5 3B Q4_K_M on CPU: **≈4.1 generated tokens/s**, prompt evaluation 59–176 tokens/s, load already resident (load 0 s). Output length therefore dominates latency: 40-case median 28.1 s; p90 63.6 s; excerpt summary 109 s. Citation correction deadline 90 s (Linux) was never exceeded (0 extractive fallbacks).

## Resources
| Component | Memory (steady, model loaded) | Limit |
|---|---|---|
| Ollama + Qwen | 2.41 GiB | 3.5 GiB |
| Intelligence (FastAPI + MiniLM) | 0.39–0.61 GiB | 2.25 GiB |
| API (Node) | 50–67 MiB | 640 MiB |
| PostgreSQL | 29–56 MiB | 512 MiB |
| Host available | ≈3.6 GiB during the 40-case run, 4.2 GiB idle-warm | — |
OOM events: 0 (both boots). Swap: none (not needed). CPU: load ≈2.1 (fully used) during generation; file listing during inference stayed ≈450 ms via tunnel and the 409 concurrency limit prevented queue build-up. Disk: images 4.6 GB, models 1.9 GB, 9.2/29 GiB used after removing the downloaded archives.

## Settings in effect
OLLAMA_NUM_PARALLEL 1, MAX_LOADED_MODELS 1, KEEP_ALIVE 15 m, context 6144, CPU library only; LLM_THREADS 2; OMP 2; LLM_TIMEOUT 180 s; correction 90 s; one generation at a time (409 otherwise); Node heap 384 MB; Postgres shared_buffers 128 MB, max_connections 30; json-file logs 5 MB × 2; tmpfs bounded. No change was needed: memory had headroom and quality held at 40/40. Reducing context/output only to improve latency was deliberately not done.

## Comparison
Windows laptop (RTX 4050): warm ≈1.5 s, model-cold ≈6.9 s. EC2 CPU: warm ≈30 s, cold ≈71 s. EC2 is ≈20× slower for generation but retrieval is as fast. Adequate for a demonstration with `aws:warmup` beforehand; not GPU-equivalent. A larger or GPU instance would need a new financial decision.
