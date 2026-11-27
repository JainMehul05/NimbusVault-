# NimbusVault

**UCS503P · Software Engineering Project · 2026–27 Odd Semester**
**Department of Computer Science and Engineering, Thapar Institute of Engineering and Technology (Deemed to be University), Patiala**

AI-powered cloud storage and document intelligence: permission-controlled file management, semantic/BM25/hybrid search, multi-document RAG and source citations, with Windows standalone and bounded Linux EC2 hosting.

## Team and supervision

| Roll number | Student |
|---|---|
| 1024030021 | Saras |
| 1024030020 | Mehul Jain |
| 1024030012 | Mansimar Kaur |

Supervisor: **Dr. Paramveer Sidhu**. Names, roll numbers and university details are preserved from the original submission; no individual contribution is inferred or fabricated.

## Academic submissions and journals

1. [Original project proposal](project-proposal/README.md) · [PDF](project-proposal/NimbusVault_Project_Proposal.pdf) · [LaTeX](project-proposal/main%20%283%29.tex)
2. [Original prototype-stage report](project-report-prototype-stage/README.md) · [PDF](project-report-prototype-stage/NimbusVault_Project_report.pdf) · [LaTeX](project-report-prototype-stage/NimbusVault_Project_report.tex)
3. [Final-report source and build instructions](project-report-final/README.md) · [existing report snapshot PDF](project-report-final/NimbusVault_Final_Project_Report.pdf)
4. [Individual team-member journals](journals/index.md) · [Saras](journals/1024030021-saras/index.md) · [Mehul Jain](journals/1024030020-mehul-jain/index.md) · [Mansimar Kaur](journals/1024030012-mansimar-kaur/index.md)

The original submissions are byte-for-byte historical recoveries. No genuine authored journal entries for these students were found; that gap is stated explicitly, while original template examples are preserved separately. The existing final report predates completed public deployment; its final revision is pending the completed Groq verification/checkpoint. This structural release restores the university layout; it does not certify the pending Groq deployment or revised final report.

## Objectives and implemented features

Secure storage and sharing, discoverable documents, grounded answers with citations, preserved user data, reproducible standalone operation and bounded cloud expenditure. The application includes authentication/refresh rotation, nested folders, permissions/inheritance, share links, trash/restore, MiniLM embeddings, FTS5 BM25 and hybrid ranking, Qwen2.5 3B generation, multi-document history/citations and public asynchronous answer jobs.

Groq provider, quota and privacy implementation has a local checkpoint (`caa4548`); AWS Session C verification is still pending. This repository snapshot retains the published Session B application until the completed Session C report and checkpoint are available.

## Source and installation

The complete application, infrastructure, tests and operation scripts are in **[code/](code/README.md)**. This is the official template's source-code folder; there is no duplicate application at repository root.

```powershell
git clone https://github.com/JainMehul05/NimbusVault-.git
cd NimbusVault-/code
# Complete Docker Desktop first-run setup, then start Docker before initial installation.
npm run setup
```

Normal local demonstration: double-click `code/Start NimbusVault.bat`, wait for readiness and MiniLM/Qwen warmup, then use http://127.0.0.1:3100. Finish with `code/Stop NimbusVault.bat`. The AWS versions and `code/NimbusVault Status.bat` are retained with their full supporting source. All advanced npm commands run from `code/`.

The active working application at the existing standalone development directory remains in its existing layout, with its desktop shortcuts and private runtime unchanged. Only this isolated publication worktree uses the university layout. See [the layout mapping](docs/PUBLICATION_LAYOUT.md).

## Architecture and technology

React/TypeScript/Vite/Tailwind → Express/Prisma/PostgreSQL for authentication and resource policy → private FastAPI/Python for extraction, chunking, normalized 384D MiniLM embeddings, SQLite vectors/FTS5, BM25/hybrid retrieval and Ollama/Qwen2.5 3B Q4_K_M RAG. Citation validation and current permissions constrain returned evidence.

AWS: S3/S3 Vectors, EventBridge, SQS/DLQ, Lambda, Step Functions, DynamoDB, CloudWatch, IAM/STS, Parameter Store, CloudFormation, EC2/encrypted EBS, Scheduler, API Gateway/VPC link/Cloud Map and SSM. Heavy AI inference remains on the application host, separate from bounded cloud workflow stages.

**Verified AWS public address:** https://d00xx7hyr7.execute-api.ap-southeast-2.amazonaws.com . The application is available only during an authorized EC2 hosting session. Free-plan eligibility and credits are finite; stopped storage still consumes credits. CloudFront remains pending AWS account verification. No permanent-free-hosting claim is made.

![Genuine public application interface](docs/evidence/public/public-landing.png)

## Documentation and university scaffold

This organization follows [the official UCS503P template](https://github.com/tiet-ucs503/ucs503p-202627odd-template): three separate LaTeX submissions, `code/`, `docs/`, individual `journals/`, root `assets/`, MkDocs, Makefile, pyproject and GitHub Actions.

```text
.github/workflows/                 Application CI and university documentation
assets/                            TIET/template assets and styles
code/                              Complete application and infrastructure
  backend/ frontend/ intelligence/
  deployment/ infrastructure/ infra/
  scripts/ e2e/ benchmarks/ config/
docs/                              Technical documentation and recovery evidence
journals/                          Team recovery-status pages and historical examples
project-proposal/                  Exact original proposal and later original revision
project-report-prototype-stage/    Exact original prototype submission
project-report-final/              Final report source/assets; verified update pending
Makefile  pyproject.toml  uv.lock   Reproducible documentation build
mkdocs.yml  .gitignore  LICENSE    University scaffold and publication protections
```

Install `uv`, then run `make docs` for a local site or `make docbuild` to build it. Direct Windows equivalent: `uv run --locked --extra docs mkdocs serve`. Assets, journals and report downloads are published virtually during the documentation build; no symlinks or duplicate application tree are required. The workflow supports the actual default branch, `main`. GitHub Pages deployment requires Settings → Pages → GitHub Actions and repository variable `ENABLE_GITHUB_PAGES=true`; no paid service or forced history update is used.

- [Template comparison and recovery status](docs/UNIVERSITY_TEMPLATE_COMPLIANCE.md)
- [Architecture](docs/ARCHITECTURE_FINAL.md), [API](docs/guides/api.md), [database](docs/phase-0/03-Database.md)
- [Public deployment](docs/PUBLIC_DEPLOYMENT_GUIDE.md), [AWS verification](docs/AWS_FINAL_DEPLOYMENT_REPORT.md), [demonstration](docs/UNIVERSITY_DEMONSTRATION_GUIDE.md)
- [Security](docs/AWS_DEPLOYMENT_SECURITY.md), [costs](docs/AWS_DEPLOYMENT_COST_REPORT.md), [search](docs/EC2_SEARCH_BENCHMARK.md), [RAG evaluation](docs/EC2_AI_QUALITY_EVALUATION.md)

## Verification and limitations

Retained Session B results: backend 309, frontend 60, Python 83 plus two Windows real-Qwen tests, infrastructure 22; public browser 54 route/viewport checks plus seven workflows. The 84-query hybrid search regression achieved 69/69 positive top-1 and 15/15 negative rejection; the retained 40-case Qwen run accepted 31 genuine generated answers and nine abstentions. These are finite development/regression results, not universal accuracy or an independent holdout. Later Groq results must come from its completed verification, not inference from these earlier benchmarks.

CPU answer latency, single-generation concurrency, finite credits, residual container CVEs, pending CloudFront verification, missing genuine historical student journals and the pending final-report/Groq revision remain explicit limitations. Private databases/conversations, credentials, invitation codes, runtime manifests, backups, dependencies and model binaries are excluded. Dependencies/models are installed separately through the included setup procedures.

Licensing and original attributions are described in [LICENSE](LICENSE); this repository organization does not invent a blanket application licence.
