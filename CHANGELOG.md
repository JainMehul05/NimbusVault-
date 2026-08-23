# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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