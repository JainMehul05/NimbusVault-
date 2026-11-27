> Historical structural-publication record. The owner later changed the academic directories on GitHub. Current filenames and availability are documented in [Academic submissions](academic-submissions.md); this audit preserves the owner-managed trees exactly.

# University publication layout and active-development mapping

This repository follows the official UCS503P layout without moving the separately running working application. The authoritative development folder remains the existing standalone development directory; its desktop shortcuts, private databases, model/cache paths and AWS manifests remain there. All moves in this preparation occurred only in a separate clean Git worktree under the ignored `.runtime/university-publication/` directory.

## Layout mapping

| Previous publication location | University publication location |
|---|---|
| `backend/`, `frontend/`, `intelligence/` | `code/backend/`, `code/frontend/`, `code/intelligence/` |
| `infrastructure/`, `infra/`, `deployment/` | Corresponding directories under `code/` |
| `scripts/`, `benchmarks/`, `samples/`, `e2e/`, `config/` | Corresponding directories under `code/` |
| npm manifests, Docker/Compose files, environment example and five batch launchers | `code/` |
| Technical documentation | `docs/` |
| Original underscore-named proposal revision | `project-proposal/revisions/2026-10-13/` |
| Earlier completed final-report package | `project-report-final/` |
| Historical root handover/engineering notes | `docs/history/` |

Run application commands from `code/`: `npm ci`, setup/build/test commands, and the batch launchers. The launchers and PowerShell/Python helpers derive the application root from their own paths, so they retain the existing internal structure. Docker build contexts remain the application root (`code/`); host-side deployment bundles still extract the application at `/opt/nimbusvault`, with paths relative to the application root. Source organization does not change the live AWS host.

Existing application CI keeps all checks and changes its working directories and npm cache/artefact paths to `code/`. The documentation environment is separate at the university repository root. Maintenance scripts that write sanitized reports now target the root `docs/`; private runtime outputs still target `code/.runtime/` and remain ignored. Original academic files are never rewritten by these adapters.

## Fresh clone

```powershell
git clone https://github.com/JainMehul05/NimbusVault-.git
cd NimbusVault-/code
# Install prerequisites and complete Docker Desktop setup before first setup.
npm run setup
```

Use `Start NimbusVault.bat` / `Stop NimbusVault.bat` inside `code/`. For AWS, the operator must supply their own approved private deployment configuration; public examples never grant authorization. No database, model distribution, invitation code or secret is included.

## Documentation

From the repository root, `uv sync --locked --extra docs` installs a separate documentation environment. `uv run --locked --extra docs mkdocs build` builds the site; `make docs` serves it. Only Git-tracked root assets, individual journals and report assets are copied virtually by `mkdocs-gen-files`, avoiding fragile Windows symlinks and committed duplicate directories. Academic PDF/LaTeX downloads are made available under the built site's `academic/` path. The original root report files remain directly visible on GitHub.

The GitHub Pages workflow builds on the actual default branch (`main`) and uses Pages artifacts rather than force-pushing a history branch. To deploy, configure repository Settings → Pages → Source: GitHub Actions and set `ENABLE_GITHUB_PAGES=true`. If these settings are unavailable, the owner must complete them; no paid service is enabled by this preparation.

## Structural release and subsequent implementation update

The user explicitly authorized publishing this verified structure without waiting for AWS Session C. This structural release contains the previously published Session B application, the restored original submissions and the historical final-report snapshot. Unfinished Groq changes are excluded. After the completed verification report/checkpoint is provided, import that verified source into the same mapping, update the final report with actual evidence and repeat applicable checks for a subsequent commit. No force push, working-directory reset or AWS operation is part of this publication.

Current update: all `project-report-final/` contents were removed at the owner's explicit request. Previous descriptions above record the structural release. The original proposal/prototype and Git history remain preserved. Git does not display empty directories.
