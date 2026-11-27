# Groq on AWS — Session C proposal (NOT yet authorized)

27 Nov 2026. All provider work and model selection were done locally; no AWS change has been made.

## Model and account
- Account plan: **Free** (confirmed by you in the Groq Console). Models visible to the key: gpt-oss-20b/120b (production), qwen3.8-27b (preview), plus speech/guard models.
- Free limits for the gpt-oss models (Groq docs, organization-wide): 30 RPM · 1,000 RPD · 8,000 TPM · 200,000 TPD. App budgets kept below them: 20 req/min, 6,000 tokens/min, 400 req/day, 120,000 tokens/day, 40 questions/user/day — persisted in the intelligence database.
- **Selected `openai/gpt-oss-20b`** (production): 12/12 on a representative 12-case subset, 0 corrections, median 0.96 s end-to-end, ~1,145 tokens/request. gpt-oss-120b also 12/12 but ~40 % slower and needed a correction; qwen3.8-27b 12/12 but **preview** (Groq: not for production). Full 40-case results: `docs/GROQ_AI_EVALUATION.md`.
- Groq data handling (docs): no retention of inference inputs/outputs by default; optional Zero Data Retention in Data Controls (recommended: enable it in the console — your action).

## Privacy design (already implemented)
Groq receives only the question and authorized retrieved excerpts, and only for files whose **owner** and the **asker** both enabled "Allow fast cloud AI" (default off). Shared readers can never release an owner's file. Indexing, MiniLM embeddings, BM25/hybrid search and permissions stay on EC2. Excluded passages fall back to excerpts (EC2: Qwen fallback disabled to avoid loading it).

## AWS changes requested
1. **SSM Parameter Store SecureString (Standard, free)** `/nimbusvault/groq/api-key`, written from the laptop by reading the local key file (no command arguments, no chat).
2. **App instance role inline policy**: allow `ssm:GetParameter` on that one parameter (+ `kms:Decrypt` via SSM for the AWS-managed key) and add it to the existing explicit deny's exception list.
3. **Host**: fetch script writes `/opt/nimbusvault-private/groq-api-key` (mode 0400, intelligence UID only); compose mounts it read-only into the intelligence container only; value never printed, never in SSM parameters/output.
4. **Deploy patch** (≈ 2 MB, temporary S3 object under `cloudvault/deployment/`, deleted afterwards): API thin layer (backend + frontend build, Prisma client with Linux engine, migration `external_ai_consent`), intelligence thin layer (provider code); env `LLM_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-20b`, `OLLAMA_FALLBACK_ENABLED=false`. Qwen/Ollama assets untouched (rollback = env back to `ollama`).
5. Optional within the window: one native EventBridge/SQS window ≤ 15 min with the independent restore schedules (same as before), ≤ 2 synthetic uploads, ≤ 1 S3 Vectors query.

## Session and cost
- One bounded session ≤ 2 h (`aws:start --hours 2`), all existing safeguards; expected ≈ 1.5 h → ≈ USD 0.20 AWS credits; Parameter Store Standard free; Groq Free ≈ 40–60 requests / ~70k tokens. ₹0 out-of-pocket; no paid plan on Groq or AWS.
- Tests: public URL Groq answers (single/multi-doc, citations, abstention, consent off/on, rate-limit message), 84-query search on EC2, provider-down behaviour, AWS launcher Start/Stop **double-clicked by you**, phone test with a real AI question, EC2 stopped at the end.

## Rollback
Set `LLM_PROVIDER=ollama` on the host and recreate intelligence (Qwen returns, no data loss); previous images remain tagged; delete the parameter and policy statement if abandoned.

## Needs from you
1. Approve Session C as above. 2. Please pause the other tool (it pushed `e195e9d` to GitHub `main` at 20:12 IST; no secrets were found in it) so only one agent operates EC2.
