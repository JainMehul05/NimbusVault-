# AI provider publication status

The current published application is the verified Session B/Qwen source (`e195e9d` before relocation into `code/`). Retrieval and citations run in NimbusVault; private generation uses Ollama with `qwen2.5:3b`.

The separate development branch has local Groq checkpoint `caa4548` (`claude/groq-integration-20261127`). Source inspection confirms an `openai/gpt-oss-20b` provider, consent migration and enforcement, provider selection, persistent quota ledger, provider tests and provider-aware warmup. The deployment agent's latest checkpoint text still marks AWS Session C **in progress** and additional deployment/UI verification files are uncommitted. Those unfinished changes are not copied into this release.

The local evaluation report at that checkpoint records 40/40 strict cases: 31 generated answers, nine abstentions, zero quotation/permission failures, median 1.24 s and p95 3.6 s, excluding deliberate quota-pacing waits. Its comparison with the earlier EC2 CPU Qwen median of 28.1 s is approximately 22.7 times, across different execution environments. This audit did not rerun that benchmark, and these numbers are not published-runtime performance or completed Session C acceptance.

Backend 313, frontend 63 and Python 97 were requested as candidate newer regression counts. They are not adopted as current release results without a completed, verified integration checkpoint. The audit report distinguishes actually rerun published-source checks from retained deployment evidence.

Secure key configuration helpers alone do not imply that the provider is included or deployed. Do not enable a missing provider on this published source. The completed integration, its deployment report and revised documentation belong in a subsequent verified release. No real key or private deployment manifest is included here.
