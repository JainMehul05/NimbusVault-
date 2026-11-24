# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-11-23

### Security
- Activity feed is derived from the access token; `GET /activity?userId=<other>` now returns 403 (was an IDOR exposing any user's history). Per-resource history requires ownership; other actors' IP addresses are never returned.
- Viewers/editors can no longer delete files; viewers can no longer move them; editors cannot move a file out of the owner's tree. Quota is released from the owner, exactly once.
- Editors can no longer change or revoke the owner's grants or grant the owner a role.
- Inherited folder permissions now apply at any depth and stop when an ancestor is deleted.
- Share links: O(1) SHA-256 lookup key (previously every public request bcrypt-scanned all links), atomic download limits, owners may revoke editor-created links, password accepted via `X-Share-Password` header, query strings stripped from request logs.
- Dedicated credential rate limit; access tokens must carry `type: access`; production refuses to start with weak or identical JWT secrets.

### Fixed
- Root folder contents endpoint returned nothing; shared folders (and subfolders) can now be browsed by collaborators.
- Folder-ID validation accepted any string; malformed JSON returned 500.
- Recursive folder delete did not release storage quota; concurrent uploads could exceed quota.
- Missing activity events (uploads, sign-ins, failed sign-ins, sign-out, folder create/rename/move/delete); rename events recorded `unknown` old names; permission updates were logged as revocations.
- Compiled backend failed to start (`Cannot find module '@config/index'`); the build now rewrites path aliases.
- Markdown uploads were rejected; text files were categorized as "other".
- Global rate limit (100 requests / 15 min) was low enough to break normal use; now configurable (default 1000).
- Readiness check reported a non-existent Redis as healthy; it now checks database, storage and AI.

### Added
- Phase 4 AI document intelligence: extraction, chunking, local or OpenAI-compatible embeddings, pgvector search, summaries, grounded Q&A with citations, durable background worker, Document insights dialog and Ask NimbusVault page.
- Prisma migrations (`0_init` baseline + additive Phase 4 migration); CI now applies migrations, runs LocalStack, and smoke-starts the compiled server.
- 64 new backend tests and 14 new frontend tests.

### Changed
- `bcrypt` 5 -> 6 (prebuilt binaries ship in the npm package; fixes installs on Node 24/Windows without build tools). API unchanged.
- Docker Compose uses `pgvector/pgvector:pg16`, applies migrations on start, creates the LocalStack bucket, and caches the embedding model.

## [v0.1.0] - 2026-08-23

### Added

#### Architecture (Phase 0)
- Complete Software Requirements Specification (SRS)
- System Architecture Design with Mermaid diagrams
- Database Schema Design (Users, Sessions, Tokens, Files, Folders, Sharing, Activity Logs)
- API Specification with OpenAPI/Swagger
- Technology Stack Selection and Justification
- Security Architecture (Authentication, Authorization, Data Protection)
- Scalability Planning (Horizontal scaling, Caching, Load balancing)
- Observability Strategy (Logging, Metrics, Tracing, Alerting)
- Disaster Recovery Plan (Backup, Restore, RPO/RTO)
- Testing Strategy (Unit, Integration, E2E, Contract)
- Team Structure & Development Workflow
- Project Roadmap (4 Phases)

#### Foundation & Authentication (Phase 1)
- Monorepo structure with npm workspaces (backend, frontend)
- Backend: Express.js + TypeScript + Prisma ORM + PostgreSQL
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Docker Compose development environment (PostgreSQL, Backend, Frontend)
- Database schema implementation with Prisma migrations
- Authentication Module:
  - User Registration with validation
  - User Login with bcrypt password verification
  - JWT Access Tokens (15 min expiry, RS256/HS256)
  - Refresh Token Rotation with Token Family tracking
  - Refresh Token Reuse Detection (Security Feature)
  - Secure Logout with Token Family Revocation
  - Protected Routes Middleware (Backend)
  - Protected Route Component (Frontend)
  - Auth Context for State Management (Frontend)
- Input Validation with Zod Schemas
- Standardized Error Handling (AppError class)
- Standardized API Response Format
- Security Hardening:
  - Helmet.js for HTTP Security Headers
  - express-rate-limit for API Rate Limiting
  - CORS Configuration
  - Secure Cookie Options (HttpOnly, Secure, SameSite)
- Structured Logging with Pino
- Health Check Endpoints (/health, /ready)
- Comprehensive Test Suite:
  - Backend: 27 Integration Tests (Jest + Supertest)
  - Frontend: Component Tests (Vitest + React Testing Library)
  - Test Coverage: Auth flows, Token rotation, Protected routes
- CI/CD Pipeline (GitHub Actions):
  - Lint (ESLint)
  - Type Check (TypeScript)
  - Test (Jest, Vitest)
  - Build (TypeScript compilation, Vite build)
  - Docker Build Verification
- Documentation:
  - Architecture Documentation (Mermaid diagrams)
  - API Documentation
  - Database Documentation
  - Testing Documentation
  - Setup Guide
  - Implementation Guides

### Changed
- N/A (Initial release)

### Deprecated
- N/A (Initial release)

### Removed
- N/A (Initial release)

### Fixed
- N/A (Initial release)

### Security
- Implemented Refresh Token Rotation with Reuse Detection
- Password Hashing with bcrypt (12 rounds)
- JWT Secrets Minimum 32 Characters Enforcement
- Rate Limiting on Auth Endpoints
- Helmet Security Headers (CSP, HSTS, X-Frame-Options, etc.)
- CORS Restricted to Frontend Origin
- Input Validation on All Endpoints
- Structured Error Responses (No Stack Traces in Production)

---

## Release Tags

- `v0.1.0-phase1-foundation` - Phase 0 Architecture + Phase 1 Foundation Release

## Links

- [Repository](https://github.com/JainMehul05/NimbusVault-)
- [Issues](https://github.com/JainMehul05/NimbusVault-/issues)
- [Pull Requests](https://github.com/JainMehul05/NimbusVault-/pulls)