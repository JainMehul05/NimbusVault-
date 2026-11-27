# EC2 Qwen quality evaluation (40 strict cases)

Run 27 Nov 2026 09:42:07–10:00:11 UTC inside the EC2 intelligence container with native Linux CPU Ollama 0.40.18, `qwen2.5:3b` Q4_K_M (digest 357c53fb…, context 6144, 0 VRAM). 24 original + 16 challenge cases (cases sha256 e2fa59b0…), unchanged rubric; isolated data; **0 AWS calls**; no paid API; laptop not involved.

| Measure | EC2 | Windows/Linux baseline |
|---|---|---|
| Strict acceptance | **40/40** | 40/40 |
| Genuine generated answers | **31/31** | 31/31 |
| Correct abstentions | 9/9 | 9/9 |
| Extractive fallbacks | **0** | 0 (first Linux run had 2 before the correction-timeout fix) |
| Mean fact coverage | 1.0 | 1.0 |
| Quotation failures / scope (permission) failures | 0 / 0 | 0 / 0 |
| Median total latency | 28.1 s | Linux laptop CPU 19.9 s; Windows GPU ≈1.5 s warm |
| Generated p90 / max | 63.6 s / 75.9 s | — |

Categories covered: single fact, numeric, date, identifier, paraphrase, explanation, technical, comparison, multi-document, follow-up and pronoun follow-up, summary (excerpt), long-document end, ambiguous, unsupported, unauthorized, empty scope, prompt injection.

Application-level RAG on EC2 (new synthetic uploads): single-document answer, multi-document synthesis citing both files with every cited sentence verbatim in its snippet, conversation follow-up (scope preserved), unsupported → `insufficient`, excerpt summary (generated, 109 s), prompt-injection memo answered without secrets or commands, revoked document → `insufficient`, Ollama stopped → labelled `extractive` (not counted as generation), cloud paused → RAG still generated, concurrent second question → 409, cancellation → 499. Not a guarantee of perfect accuracy. Raw: `.runtime/aws-deployment/ai-40-ec2-session-a.json`.
