# GitHub publication audit

November 27, 2026. Target: https://github.com/JainMehul05/NimbusVault- (default branch `main`). Publication uses a normal descendant commit and standard push, preserving history, other branches, releases and tags.

## Recovery and source

Previous fetched remote `main`: `06bccdfafcecd75316a70b3e6c39018205d5fd65`.
Local recovery reference: `codex/recovery-github-main-20261127`.
Latest completed application/deployment checkpoint: `2d7f71cf18a87edf0b7ca375fb3002b8f3ceb236` (Session B). Windows standalone and AWS Session A/B checkpoint tags remain intact. Publication is prepared on `codex/github-publication-20261127`; the original deployment branch is retained.

The public deployment checkpoint was read before publication. Session B records a verified AWS API Gateway HTTPS endpoint; CloudFront distribution creation is pending account verification. The publication task performs no AWS mutations and does not start/stop services to repeat a deployment benchmark.

## Security and file inventory

All 1,072 historical blobs reachable from the source checkpoint (12,935,874 uncompressed bytes) were scanned before staging. No matches were found for AWS access-key IDs, GitHub/Groq token patterns, PEM private-key blocks, JWT token strings or thirteen concrete private configuration values compared without printing their contents. The final planned source tree was separately scanned with the same rules. Public application screenshots, including earlier screenshot versions in history, were visually checked for private credentials/documents; they show synthetic demonstration content or public UI. The completed academic report contains its authorized university/student details and sanitized evidence.

No scanner can prove the absence of every possible secret; this records the rules applied and observed result. A finding in newly published history would block publication rather than being hidden by a latest-commit deletion. No history rewriting or force push is authorized or used.

The publishable tree excludes actual `.env`, AWS caches/credentials, database files/backups, private conversations, recovery copies, live authorization/deployment manifests, invitation codes, desktop `.lnk` files, runtime logs, executable/model distributions, Python environments, node_modules, archives and build caches. Reviewed example schemas are deliberately unapproved and contain placeholders. `.gitignore` now protects these categories and whitelists only the reviewed academic-report assets.

Forty-four obsolete prototype/placeholder files were removed **from the Git index only**: unrelated C++ sample/compiled output, the duplicate landing-page prototype, original proposal/prototype-report directories, and two empty documentation placeholders. Their necessary local copies were preserved. Their historical commits remain accessible intentionally. No application source, database, model or recovery directory was deleted.

GitHub's documented regular-Git limit is 100 MiB per file (warning above 50 MiB): https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github . The planned tree contains no file above 50 MiB, and no Git LFS model upload is used.

## Reproducibility and verification

The source includes frontend/backend/intelligence, Prisma migrations, dependency manifests/locks, synthetic benchmarks, tests, CloudFormation/Lambda and CDK source, Linux deployment/backup/safeguard scripts, all five Windows batch launchers and their helpers, current deployment/demonstration guides and the completed academic PDF/LaTeX source snapshot. Setup downloads dependencies/models separately; private account-specific configuration must be provided by the operator. The original CloudVault source directory is not required by application startup/setup.

Fresh publication checks passed:

- `npm run build` (backend and frontend).
- `npm run lint` (backend and frontend).
- Frontend: 60 tests across 14 files.
- Infrastructure: 22 tests.
- AWS launcher: 10 focused safety tests; Docker launcher: two isolated orchestration tests.
- Local and EC2 Compose configuration validation.
- Python parsing for 72 publishable source files (the report's optional diagram generator emits benign escape-sequence warnings).
- README local-reference validation and Git whitespace checks.

Post-push CI exposed two publication defects that were corrected without changing AWS resources: a Windows-encoded dash in `STANDALONE_VERIFICATION_REPORT.md` prevented MkDocs from decoding that page, and the legacy development Compose API inherited the standalone loopback bind address, preventing its nginx container from reaching it. Documentation is now valid UTF-8 with an explicit CI encoding check; the development API binds its container interface while host ports remain loopback-only. The complete documentation site builds locally. CI outcomes are recorded separately from retained application benchmark evidence.

The prior Session B backend/Python/real-model/cloud/browser benchmarks are retained evidence, not newly rerun by this publication task. Destructive database suites were not pointed at private data, and expensive generation benchmarks were not repeated unnecessarily.

The report PDF was rendered/reviewed and independently rebuilt during its creation; its local README explicitly labels the pre-deployment status snapshot. Runtime evidence, the typesetting virtual environment, raw captures and a duplicate source ZIP are excluded from publication.

## Post-push verification

The publication process must fetch `main` after pushing, compare its commit and complete tree to the intended publication, and verify a separate lightweight clone. The exact published commit, final file count/size, clone and remote verification results are recorded in the final handoff and in ignored `.runtime/github-publication/` evidence. This document does not assert success merely from a local commit.

## Remaining limits

The public site only serves the application during a bounded approved hosting session. Retained EBS incurs storage consumption while stopped. CloudFront remains pending account verification. Residual container CVEs and CPU latency remain documented. The academic report snapshot predates completed EC2/public deployment and must be read alongside the later Session A/B reports. The optional private Groq key-storage helper is included without claiming a verified hosted-provider integration. No credentials are distributed with the source.
