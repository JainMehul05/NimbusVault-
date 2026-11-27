# Verified AI providers — Session C

The published source includes completed checkpoint `ef9872c` from `claude/groq-integration-20261127`, following inspection of its final deployment report and clean committed source. The earlier local checkpoint `caa4548` is its predecessor, not the final deployment checkpoint.

## Implementation and privacy

`code/intelligence/app/llm.py` implements Groq `openai/gpt-oss-20b` with strict structured output and a fixed HTTPS provider endpoint. `provider_quota.py` reserves persistent request/token budgets transactionally before provider calls. Provider failures, corrections and cooldowns are accounted for. `rag.py` chooses only permitted providers; local Qwen remains available when configured. Provider-aware launchers avoid claiming a Qwen warmup when Groq is selected.

Backend `externalScope` requires the asker and every included document owner to opt in; share access alone grants no external-processing consent. Retrieval, MiniLM embeddings, storage and source validation stay in NimbusVault. External provider credentials are read from a private runtime key file; on EC2 that file is fetched from Parameter Store SecureString with the instance role and mounted only into intelligence. Actual keys and private manifests are excluded.

## Verified evidence, not a new cloud run

The deployment agent reports Session C complete and EC2 stopped at 16:24 UTC on 27 November 2026. Public tests covered consent, scoped single/multi-document answers, follow-up/abstention, revoked access, provider outage, native AWS workflow reconciliation, start/stop and citations. Browser click-to-visible samples were 1.5 s, 1.6 s and 3.0 s; API-path timings include polling and differ. The unchanged 84-query search remained at 69/69 positives and 15/15 negative rejection.

Local strict Groq benchmark: 40/40, 31 generated answers and nine abstentions, no measured quotation/permission failures, median 1.24 s and p95 3.6 s, excluding deliberate pacing waits. Comparison with historical EC2 Qwen median 28.1 s is approximately 22.7 times across different environments, not universal performance. Reported Session C regressions: backend 313, frontend 63, Python 97; two real-Qwen tests were not rerun. Fresh isolated publication checks are recorded in the repository audit.

Remaining: mobile AI question, Groq Console Zero Data Retention toggle and finite Free-tier limits. SecureString uses AWS-managed KMS encryption; no separate customer-managed KMS key deployment is claimed. CloudFront distribution remains undeployed. See [integration guide](GROQ_INTEGRATION_GUIDE.md), [evaluation](GROQ_AI_EVALUATION.md) and [deployment report](AWS_FINAL_DEPLOYMENT_REPORT.md).

The GitHub audit only reads these completed checkpoint reports and source; it performs no AWS or provider API operation and does not modify the active application.
