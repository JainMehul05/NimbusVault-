# NimbusVault

Secure cloud storage with sharing and document intelligence, built with React, TypeScript, Express, PostgreSQL/pgvector and S3-compatible storage, with AWS infrastructure as code.

> **Status:** Phases 1–5 are implemented. Everything that can be checked without an AWS account has been (see the [engineering report](NIMBUSVAULT_FINAL_ENGINEERING_REPORT.md)). It has **not** been deployed to AWS, and hosted-LLM answers have not been tried with a real API key.

## What it does

- **Accounts**: registration, sign-in, per-device sessions you can end, password change. Refresh tokens rotate in an HttpOnly cookie; nothing usable is kept in browser storage.
- **Files**: upload (direct or presigned), download, rename, move, search, sort, nested folders, quotas, trash with restore and automatic purge.
- **Sharing**: Viewer and Editor roles on files and folders with inheritance, shared-by-you overview, and share links with expiry, password, download limit and revocation.
- **Activity**: an audit trail of what you and others did with your files.
- **Document intelligence** (optional): PDF, DOCX, Markdown and text indexing with local embeddings, semantic search, optional OCR of scans, and summaries and cited answers when an LLM provider is configured. Always limited to documents you can currently read.
- **Operations**: Docker stack, CI with real PostgreSQL, LocalStack and Chromium, AWS CDK, monitoring, backups and runbooks.

## Quick start

```bash
git clone https://github.com/JainMehul05/NimbusVault-.git
cd NimbusVault-
docker compose up --build
```

Open http://localhost:5173. Without Docker, or for hot reload, see [local development](docs/guides/local-development.md).

## Documentation

| | |
|---|---|
| Understand | [Architecture](docs/guides/architecture.md) · [API](docs/guides/api.md) · [Security](docs/guides/security.md) · [AI](docs/phase-4/ai-document-intelligence.md) · [Status](docs/guides/status.md) |
| Run | [Local development](docs/guides/local-development.md) · [Docker](docs/guides/docker.md) · [Environment variables](docs/guides/environment.md) · [Migrations](docs/guides/migrations.md) · [Troubleshooting](docs/guides/troubleshooting.md) |
| Deploy | [AWS architecture](docs/phase-5/aws-architecture.md) · [Deployment](docs/phase-5/aws-deployment.md) · [CI/CD](docs/phase-5/ci-cd.md) · [Backup, recovery, rollback](docs/phase-5/operations.md) · [Costs](docs/phase-5/cost.md) |
| History | [Changelog](CHANGELOG.md) · [Integration report](docs/release/integration-report.md) · [Phase 0 design documents](docs/index.md) |

## Commands

| Command | |
|---|---|
| `npm ci` | Install every workspace |
| `npm run dev:backend` / `npm run dev:frontend` | Hot-reloading development servers |
| `npm run build` | Build both apps |
| `npm run lint` | Lint both apps |
| `npm run test:prepare --workspace=backend` | Create and migrate the test database |
| `npm test` | Backend and frontend tests |
| `npm run test:e2e` | Browser tests against the built apps |
| `npm test --workspace=infra` | Infrastructure tests |
| `docker compose up --build` | The whole stack |

## Layout

```text
backend/    Express API, worker, Prisma schema and migrations, tests
frontend/   React app and component tests
e2e/        Playwright browser tests
infra/      AWS CDK app, tests and deployment scripts
docs/       Guides and design documents
scripts/    LocalStack set-up, smoke test
```

`nimbus-vault-landing-page-design/` is an early design prototype kept for reference; it is not part of the product.

## Contributing

Create a branch, keep changes focused, run the commands above, and open a pull request. CI must pass. Never commit secrets or `.env` files.

## License

The `LICENSE` file is currently empty, so no license has been granted. The owners should add one before others reuse the code.
