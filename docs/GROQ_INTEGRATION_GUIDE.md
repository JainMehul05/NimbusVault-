> University layout: application commands run from `code/`; application paths below are relative to that directory. This guide records completed Session C verification, not a request to start AWS.

# Groq Cloud integration — guide

NimbusVault can generate answers with **Groq Cloud** (Free tier, `openai/gpt-oss-20b`) instead of the private Qwen2.5 3B model. Only **generation** moves outside: document storage (S3), indexing, MiniLM embeddings (384-d), BM25/hybrid retrieval, permissions, citation/quotation validation and conversation history stay inside NimbusVault (Windows laptop or the AWS EC2 instance). Groq is not Grok (xAI); no paid provider is used.

## Architecture
```
Question → backend (auth, scope, consent) → intelligence (MiniLM + BM25 hybrid retrieval, on EC2/laptop)
        → only consented excerpts → Groq gpt-oss-20b (strict JSON) → citation + exact-quote validation
        → bounded correction (counted in quota) → permission recheck → answer + history
Fallback: local Qwen (laptop) when configured; otherwise cited excerpts with a clear message.
```
Provider code: `intelligence/app/llm.py` (`generate_groq`), quota ledger `intelligence/app/provider_quota.py`, provider choice `intelligence/app/rag.py` (`choose_provider`), consent `backend/src/modules/ai/local-intelligence.ts` (`externalScope`).

## Key setup and rotation
- Laptop: `npm run ai:set-groq-key` (masked prompt) → `.runtime/secrets/groq-api-key` (Git-ignored, owner-only). Read at request time, so rotation needs no restart.
- EC2: SSM Parameter Store SecureString (Standard, free) `/nimbusvault/groq/api-key`; the host fetches it with the instance role (`deployment/ec2-groq-key.sh`) into a 0400 file owned by the intelligence user, mounted read-only only into the intelligence container. Rotate: update the parameter, rerun the fetch script.
- The key never appears in Git, chat, command arguments, SSM output, logs, API responses or the browser.

## Switching provider
- Laptop: `npm run ai:provider -- groq` or `npm run ai:provider -- ollama`, then restart (Stop/Start NimbusVault). Groq mode keeps private Qwen as an optional fallback and selectable "Private Local AI" mode.
- EC2: `LLM_PROVIDER=groq|ollama` in `/opt/nimbusvault-private/intelligence.env` (+ recreate intelligence). EC2 runs Groq with `OLLAMA_FALLBACK_ENABLED=false`, so Qwen is never loaded (rollback = set `ollama`).

## Privacy and consent
External processing happens only when **the asker** and **each document's owner** enabled *Allow fast cloud AI* (Ask page; off by default). Read access to a shared file never permits sending it. Groq receives only the question and the relevant excerpts (compact IDs, no filenames' paths, keys, tokens or other users' data); prompt-injection text in documents is treated as untrusted evidence and server-side validation rejects unsupported citations. Groq states inference data is not retained by default; enable **Zero Data Retention** in Groq Console → Data Controls for extra assurance.

## Free-tier limits (organization-wide, gpt-oss) and app budgets
Groq Free: 30 RPM · 1,000 RPD · 8,000 TPM · 200,000 TPD. App: 20 requests/min, 6,000 tokens/min, 400 requests/day, 120,000 tokens/day, 40 questions/user/day, plus the public site's 10 questions/10 min per user — persisted in the intelligence database (survives refresh, logout, restart, EC2 stop/start), reserved before each request (including corrections and ambiguous network failures). 429 → cooldown honouring `retry-after`; 401/403 → 15-min lockout with an administrator message; 5xx/network → one retry. Typical answer ≈ 1,160 tokens, so the whole site sustains ≈ 5 questions/minute.

## Results (fresh, 27 Nov 2026)
- 40-case benchmark: **40/40**, 31/31 genuinely Groq-generated, 9/9 abstentions, 0 quotation/permission failures, median 1.24 s, p95 3.6 s (laptop). Details: `GROQ_AI_EVALUATION.md`.
- Public AWS site, real browser, click → answer visible: **1.5 s, 1.6 s, 3.0 s** (summary); API path 3.8–5.6 s incl. polling; server ≈ 0.2–0.6 s, Groq ≈ 0.6 s. Previous Qwen on EC2: ≈ 30–35 s.
- Search unchanged: 84 queries on EC2 hybrid 69/69, 15/15 negatives, Recall@3 98.55 %, MRR 1.0, 0 leaks.
- Revoked/invalid key: excerpts + clear message, search keeps working, status shows outage without secrets; recovered after restoring the key.

## Rollback
EC2: set `LLM_PROVIDER=ollama` (and `OLLAMA_FALLBACK_ENABLED=true`) then recreate intelligence; previous images remain tagged `:sessionb`. Laptop: `npm run ai:provider -- ollama`. No data, embeddings or models are removed.
