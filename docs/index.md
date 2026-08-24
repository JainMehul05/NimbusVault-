# NimbusVault Documentation

**NimbusVault** is an AI-powered cloud storage and document intelligence platform: secure file storage, folder organization, sharing with fine-grained controls, and an AI assistant that answers questions about your documents using Retrieval-Augmented Generation (RAG).

## Phase 0 — Planning & Architecture (current)

| # | Document | Contents |
|---|---|---|
| 01 | [SRS](phase-0/01-SRS.md) | Problem/solution/users/goals · testable functional requirements (auth, files, folders, search, sharing, AI) · non-functional requirements with verification methods |
| 02 | [Architecture](phase-0/02-Architecture.md) | Principles · high-level & component diagrams · upload/RAG/share data flows · deployment view · why-bytes-stay-out-of-the-DB/API rationales |
| 03 | [Database](phase-0/03-Database.md) | ER model · full schema for users/folders/files/share links/permissions/activity logs · indexing, constraints, integrity scenarios · migration strategy |
| 04 | [API](phase-0/04-API.md) | REST contract v1: conventions, standard error envelope, rate limits, every endpoint with request/response/errors |
| 05 | [Technology](phase-0/05-Technology.md) | 13 ADRs — each choice with alternatives and decisive rationale · rejected ideas · version pins · cost envelope |
| 06 | [Security](phase-0/06-Security.md) | Control matrix · seven-layer tenant isolation with worked attack walkthrough · AI-specific security · STRIDE threat model |
| 07 | [Scalability](phase-0/07-Scalability.md) | Trigger-based scaling: S3, stateless API, indexes/pooling/replicas, presigned+CDN transfers, queue workers, AI scaling · load profiles |
| 08 | [Workflow](phase-0/08-Workflow.md) | Monorepo layout & boundary rules · protected-branch git flow · code style standards · Claude Code usage policy |
| 09 | [Testing](phase-0/09-Testing.md) | Pyramid & CI gates · backend integration incl. tenant-isolation suite · frontend/e2e · cloud drills · AI retrieval evaluation |
| 10 | [Team](phase-0/10-Team.md) | Four-member end-to-end ownership: responsibilities, deliverables, dependencies, interface map, accountability defaults |
| 11 | [Roadmap](phase-0/11-Roadmap.md) | Definition of done · 16-week phased plan with acceptance criteria · sprint cadence · RACI · risk register |

## Phase 1 — Foundation Implementation (current)

| # | Document | Contents |
|---|---|---|
| 01 | [Implementation Plan](phase-1/01-phase1-implementation-plan.md) | Scope→acceptance mapping · task sequence & sprint stories (NV-10x) · backend/frontend folder structures · setup commands · ready-to-use configs: `.env.example`, Prisma schema, docker-compose, Dockerfiles, GitHub Actions CI, S3/IAM JSONs · testing checklist · common mistakes · exit checklist |

## System at a Glance

```
React SPA ── NestJS API ── PostgreSQL (metadata)
                 │              AWS S3 (objects, pre-signed direct transfers)
                 │              Redis + BullMQ (async jobs)
                 └── FastAPI AI Service ── ChromaDB (vectors) + LLM
```

- **Direct-to-S3 transfers:** browsers upload/download via pre-signed URLs — API servers never touch file bytes.
- **Separate AI plane:** Python/FastAPI handles extraction, embeddings and RAG independently of the Node API.
- **Security in depth:** JWT + rotating refresh, bcrypt, least-privilege IAM, revocable expiring share links, provable tenant isolation.

## For Developers

```bash
# full local stack (Postgres, Redis, MinIO, API, frontend, AI service)
docker compose -f infrastructure/docker-compose.yml up
```

Start with the [SRS](phase-0/01-SRS.md), check pinned versions in the [Technology Decisions](phase-0/05-Technology.md), and follow branch/PR rules from the [Workflow](phase-0/08-Workflow.md) document.
