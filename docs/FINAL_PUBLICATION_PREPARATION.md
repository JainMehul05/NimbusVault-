> Historical structural-publication record. The owner later changed the academic directories on GitHub. Current filenames and availability are documented in [Academic submissions](academic-submissions.md); this audit preserves the owner-managed trees exactly.

# Final repository preparation — 27 November 2026

Status: structural publication explicitly authorized; remote verification follows the normal push. Pre-publication remote `main` was rechecked at `e195e9de7bc35f47ba55156751f4d6d22d64953c`.

## Prepared repository

```
.github/workflows/
assets/
code/
docs/
journals/
project-proposal/
project-report-final/
project-report-prototype-stage/
.gitattributes
.gitignore
LICENSE
LICENSE.template
Makefile
README.md
mkdocs.yml
pyproject.toml
uv.lock
```

The two additional attribution/integrity files are necessary: `LICENSE.template` retains the official scaffold notice, and `.gitattributes` prevents newline conversion of original academic files. Documentation helpers are under `docs/tools/`. Ignored local environments and generated site output are not part of the tracked tree.

## Evidence and checks

- Official template HEAD rechecked: `2cd8dba362da1b5178d03fe04b4f499b41525436`.
- [Original academic files, historical commits, Git blob IDs and SHA-256](academic-recovery-manifest.json): ten exact recovered files, including the four historical journal examples. The proposal and prototype PDFs were already identical in history; they remain unchanged.
- [Complete source migration record](repository-file-migration.json): baseline tracked paths mapped to their publication locations.
- [Retained focused verification](university-preparation-verification.json): isolated application build, 22 infrastructure tests, 10 AWS launcher safety tests, two Docker launcher mock tests, three Compose configurations and script syntax checks passed. These were preparation checks, not a live cloud session or full fresh installation with private configuration.
- Latest layout checker and MkDocs clean build passed after moving documentation helpers. Credential-pattern scan of the proposed index found no matches.
- Original PDFs opened successfully; final report source was compiled from a separate clone and its extracted text matched the preserved PDF. That PDF remains a pre-deployment snapshot requiring revision.
- Genuine student journal entries could not be recovered. Correct student directories contain explicit recovery notices; template examples are labelled separately.

## Authorized structural publication

The user explicitly approved publishing the prepared university structure now, independently of the pending AWS Session C and Groq work. This release retains the verified Session B application and clearly labelled historical final-report snapshot. Unfinished Groq changes are excluded. Normal history-preserving publication is conditional on renewed integrity, security and remote-ancestry checks; no further approval is required for this structural release.

The completed Session C implementation and revised report will be a subsequent commit after their verification. No claim of completed Session C is made here.

The active standalone application, private data, shortcuts and runtime are not modified by this publication. No AWS operation is performed. Existing branches, tags and history are preserved. Post-push evidence is recorded separately after inspecting actual remote main and an independent clone.
