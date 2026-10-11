# NimbusVault — Phase 1 Implementation Plan

| Field | Value |
|---|---|
| Document | Phase 1 · Implementation Blueprint (Foundation: Auth + UI Shell + Cloud/CI Prep) |
| Governing docs | SRS §2 Module A · API (04) · Security (06) · Workflow (08) · Testing (09) |
| Strictly out of scope | File upload, S3 object code paths, folders, sharing, search, AI — later phases |
| Version | 1.0 |

---

## 1. Implementation Plan

### 1.1 Scope → Acceptance Criteria Mapping

| # | Acceptance criterion (from brief) | Delivered by |
|---|---|---|
| 1 | Open application | Vite React SPA served on `:5173` (dev) / nginx (container) |
| 2 | Register account | `POST /api/v1/auth/register` + Register page |
| 3 | Login | `POST /api/v1/auth/login` + Login page |
| 4 | Receive authentication token | Access JWT in memory + refresh cookie (rotation-ready) |
| 5 | Access protected dashboard | `JwtAuthGuard`-protected `/auth/me` + `<ProtectedRoute>` |
| 6 | Database stores user | PostgreSQL via Prisma, migration `0001_init` |
| 7 | Runs through Docker | `docker-compose.yml`: postgres + backend + frontend |
| 8 | CI pipeline passes | GitHub Actions: lint → unit tests → integration tests → build |

### 1.2 Task Sequence (dependencies top-to-bottom)

| # | Task | Owner | Output / gate |
|---|---|---|---|
| T1 | Repo scaffold: create `frontend/ backend/ ai-service/ infrastructure/` with README stubs; enable branch protection (`main`, `develop`), PR template, conventional-commit lint | M3 | Protected repo; first PR merged via flow |
| T2 | Backend scaffold: NestJS TS strict app, config module with env validation, global validation pipe, error envelope filter, logging interceptor (request IDs) | M1 | `GET /api/v1/health` returns 200 in dev |
| T3 | Prisma schema + migration `0001_init` (User table). **Schema design approved by M1 before generation** (Doc 08 policy) | M1 | Migration applies cleanly to fresh Postgres |
| T4 | Auth module: register, login, me; bcrypt hashing; JWT sign/verify; refresh-token endpoint + httpOnly cookie; throttler on auth routes | M1 | Endpoints match Doc 04 contract incl. error envelope |
| T5 | Frontend scaffold: Vite React-TS, Tailwind, router shell, layout components | M2 | App boots at `:5173`, routes render |
| T6 | API client + AuthContext (token lifecycle, boot-time session restore) | M2 | Context exposes login/register/logout/status |
| T7 | Pages: Register, Login (validated forms, error states), Dashboard (protected) | M2 | Full happy path usable against local backend |
| T8 | Docker: Dockerfiles ×2 + compose stack with healthchecks | M3 (+M1/M2 inputs) | `docker compose up` → criterion 7 demoable |
| T9 | CI pipeline: quality job (lint/unit/build) + integration job (Postgres service container, migrations + supertest suite) | M3 | Green check required for all subsequent PRs |
| T10 | AWS foundation: bucket (encrypted, versioned, private), CORS, TLS-only policy, least-privilege IAM user/policy for backend role. **No upload code** | M3 | Policy JSONs reviewed & stored in `infrastructure/aws/` |
| T11 | Test suites: backend auth (register/login/invalid-password/protected) + frontend form tests | M1 + M2 | Coverage ≥70% backend core; suites green in CI |
| T12 | Hardening pass pair-review: helmet headers, rate limits verified, secrets audit, `.env.example` sync | M1+M3 | Security checklist from Doc 06 ticked for auth scope |

**Sequencing notes:** T5–T7 can start immediately after T1 using the Doc 04 contract as-is (mock server or plain fetch stubs); they do not wait for T2–T4. T8 depends on T2/T5 building successfully. T9 gates everything after it.

### 1.3 Auth Flow Specification (Phase 1 exact behavior)

```
Register: validate DTO → normalize email lowercase → uniqueness check
          → bcrypt hash (cost 12) → insert user (tx)
          → issue token pair → 201 {user, accessToken} + Set-Cookie(refresh)

Login:    lookup by normalized email → constant-time bcrypt compare
          → on failure generic 401 INVALID_CREDENTIALS (no enumeration oracle)
          → issue token pair → 200

Token:    access JWT HS256, claims {sub, email, jti, iat, exp}, TTL 15 min
          refresh token: opaque random 256-bit, SHA-256 hash stored in DB
          (`refresh_tokens` table), delivered as HttpOnly+Secure+SameSite=Lax
          cookie scoped to /api/v1/auth, TTL 7 days, rotated on every use;
          reuse of a rotated token ⇒ revoke family (Doc 06)

Me:       GET /api/v1/auth/me behind JwtAuthGuard → profile + quota fields
          (quota values present but static in Phase 1)

Logout:   POST /api/v1/auth/logout → revoke presented refresh family,
          denylist access JTI until exp → 204
```

> Phase 1 includes logout/refresh because the security design requires rotation from day one; adding them later means retrofitting cookie handling into every client call.

### 1.4 Database Addition for Refresh Rotation

Beyond the User table, Phase 1 adds one table (already anticipated by Doc 03's integrity model):

```
refresh_tokens(id uuid PK, userId uuid FK→users ON DELETE CASCADE,
               tokenHash char(64) UNIQUE, familyId uuid,
               expiresAt timestamptz, revokedAt timestamptz NULL, createdAt)
Index: (userId); uniqueness on tokenHash makes lookup O(1).
```

---

## 2. Folder Structure

### 2.1 Backend (`backend/`) — NestJS + Prisma

```
backend/
├── src/
│   ├── main.ts                        # bootstrap: global pipes/filters, versioning, swagger
│   ├── app.module.ts                  # ConfigModule(root) + DatabaseModule + ThrottlerModule + feature modules
│   ├── config/
│   │   ├── configuration.ts           # typed config factory from process.env
│   │   └── env.validation.ts          # Joi/zod schema — app refuses to boot on bad env
│   ├── common/
│   │   ├── filters/http-exception.filter.ts     # Doc 04 envelope {success,message,errorCode,requestId}
│   │   ├── interceptors/logging.interceptor.ts  # request-ID + latency structured logs
│   │   ├── guards/jwt-auth.guard.ts             # Bearer verification, 401 vs 403 semantics
│   │   └── decorators/current-user.decorator.ts # @CurrentUser() param decorator
│   ├── database/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts          # PrismaClient lifecycle + shutdown hooks
│   └── modules/
│       ├── users/
│       │   ├── users.module.ts
│       │   ├── users.service.ts               # create/find-by-email/profile queries
│       │   └── dto/user-response.dto.ts       # never exposes passwordHash
│       └── auth/
│           ├── auth.module.ts
│           ├── auth.controller.ts             # /register /login /refresh /logout /me
│           ├── auth.service.ts                # hashing, token issuance, rotation logic
│           ├── strategies/jwt.strategy.ts     # passport-jwt verify + JTI denylist check
│           └── dto/register.dto.ts login.dto.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/0001_init/migration.sql
├── test/
│   ├── auth.e2e-spec.ts               # supertest suite vs real PG (CI integration job)
│   └── jest-e2e.json
├── .env.example                       # contract of every env var (Doc 08 rule)
├── Dockerfile                         # see infrastructure/docker note in §4
├── eslint.config / tsconfig.json      # strict:true, no implicit any
└── package.json
```

### 2.2 Frontend (`frontend/`) — React + TypeScript + Tailwind

```
frontend/
├── src/
│   ├── components/
│   │   ├── layout/{Navbar,Sidebar,Layout}.tsx
│   │   └── ui/{Button,Input,Alert,Spinner}.tsx        # Tailwind primitives only
│   ├── pages/
│   │   ├── auth/{LoginPage,RegisterPage}.tsx
│   │   └── DashboardPage.tsx                          # shows profile from /auth/me
│   ├── routes/
│   │   ├── AppRoutes.tsx                              # react-router v6 route tree
│   │   └── ProtectedRoute.tsx                         # redirect unauthenticated → /login
│   ├── services/
│   │   ├── apiClient.ts                               # axios instance: baseURL /api/v1,
│   │   │                                              # request-ID header, 401→refresh-and-retry
│   │   └── authService.ts                             # register/login/logout/me wrappers
│   ├── context/AuthContext.tsx                        # {user,status,login,register,logout}
│   ├── hooks/useAuth.ts
│   ├── types/api.d.ts                                 # mirrors Doc 04 response shapes
│   ├── App.tsx
│   └── main.tsx
├── e2e/                                               # Playwright specs (login/register forms)
├── index.html  tailwind.config.js  postcss.config.js
├── .env.example                                       # VITE_API_BASE_URL
└── Dockerfile
```

### 2.3 Supporting folders created this phase

```
ai-service/README.md            # placeholder: "starts Phase 4" (keeps monorepo shape honest)
infrastructure/
├── docker/docker-compose.yml   # canonical local stack (root-level convenience copy allowed)
├── aws/s3-cors.json s3-tls-only-policy.json iam-backend-policy.json
docs/phase-1/                   # this plan
.github/workflows/ci.yml
```

---

## 3. Setup Commands

### 3.1 Prerequisites

```powershell
node -v        # must be v20 LTS
docker -v      # Docker Desktop with compose v2
aws --version  # AWS CLI v2 (Member 3 only)
```

### 3.2 Backend scaffold (from repo root)

```bash
npx @nestjs/cli@10 new backend --strict --package-manager npm --skip-git
cd backend
npm i @prisma/client @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt class-validator class-transformer @nestjs/throttler helmet
npm i -D prisma ts-node @types/passport-jwt @types/bcrypt supertest
npx prisma init
```

### 3.3 Database

```bash
# local Postgres comes from docker-compose (§4) — then:
npx prisma migrate dev --name init     # creates 0001_init against local DB
npx prisma generate                    # typed client
```

### 3.4 Frontend scaffold (from repo root, new terminal)

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm i react-router-dom axios
npm i -D tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom
npx tailwindcss init -p
```

### 3.5 Run the full stack locally (no AWS needed)

```bash
docker compose up --build       # postgres + backend(:3000) + frontend(:5173)
# or native dev loop:
docker compose up postgres -d   # DB only
cd backend && npm run start:dev
cd frontend && npm run dev
```

---

## 4. Configuration Files Required

### 4.1 `backend/.env.example` (never commit real `.env`)

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://nimbus:nimbus@localhost:5432/nimbusvault?schema=public
CORS_ORIGIN=http://localhost:5173
JWT_ACCESS_SECRET=change-me-32-bytes-min-random
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=7
THROTTLE_AUTH_LIMIT=5
THROTTLE_AUTH_WINDOW_SECONDS=60
# Phase 3+ (unused now): S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
```

### 4.2 `backend/prisma/schema.prisma`

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id           String   @id @default(uuid()) @db.Uuid
  name         String   @db.VarChar(80)
  email        String   @unique @db.VarChar(255) // stored lowercase; service normalizes
  passwordHash String   @map("password_hash") @db.VarChar(72) // bcrypt only
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  refreshTokens RefreshToken[]

  @@index([createdAt])
  @@map("users")
}

model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  tokenHash String    @unique @db.Char(64)          // sha256 hex of opaque token
  familyId  String    @db.Uuid                      // rotation family for reuse detection
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])                                // nightly cleanup job target
  @@map("refresh_tokens")
}
```

### 4.3 `infrastructure/docker/docker-compose.yml` (dev parity stack)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nimbus
      POSTGRES_PASSWORD: nimbus
      POSTGRES_DB: nimbusvault
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nimbus -d nimbusvault"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    build: { context: ../../backend }
    env_file: ../../backend/.env            # git-ignored; see .env.example
    environment:
      DATABASE_URL: postgresql://nimbus:nimbus@postgres:5432/nimbusvault?schema=public
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }

  frontend:
    build: { context: ../../frontend, target: development }
    environment:
      VITE_API_BASE_URL: http://localhost:3000/api/v1
    ports: ["5173:5173"]
    depends_on: [backend]

volumes:
  pgdata:
```

### 4.4 Dockerfiles (multi-stage; live under each service, mirrored in `infrastructure/docker/`)

`backend/Dockerfile` — build once in CI, same image everywhere:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`frontend/Dockerfile` — `development` target used by compose; `production` target for later phases:

```dockerfile
FROM node:20-alpine AS development
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

### 4.5 `.github/workflows/ci.yml` (foundation pipeline)

```yaml
name: ci
on:
  pull_request:
  push: { branches: [main, develop] }

jobs:
  quality:
    runs-on: ubuntu-latest
    strategy:
      matrix: { service: [backend, frontend] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: ${{ matrix.service }}
      - run: npm run lint
        working-directory: ${{ matrix.service }}
      - run: npm test -- --coverage
        working-directory: ${{ matrix.service }}
      - run: npm run build
        working-directory: ${{ matrix.service }}

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: nimbus, POSTGRES_PASSWORD: nimbus, POSTGRES_DB: nimbusvault_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U nimbus" --health-interval 5s
          --health-timeout 3s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: backend
      - run: npx prisma migrate deploy
        working-directory: backend
        env:
          DATABASE_URL: postgresql://nimbus:nimbus@localhost:5432/nimbusvault_test?schema=public
      - run: npm run test:e2e
        working-directory: backend
        env:
          DATABASE_URL: postgresql://nimbus:nimbus@localhost:5432/nimbusvault_test?schema=public
          JWT_ACCESS_SECRET: ci-secret-ci-secret-ci-secret-1234
```

### 4.6 Cloud foundation artifacts (created by M3, stored in `infrastructure/aws/`)

**S3 bucket (CLI) — private, versioned, encrypted; no upload code this phase:**

```bash
aws s3api create-bucket --bucket nimbusvault-files-prod --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-public-access-block --bucket nimbusvault-files-prod --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket nimbusvault-files-prod --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket nimbusvault-files-prod --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

**CORS (`s3-cors.json`) — needed before Phase 2 browser uploads:**

```json
[{
  "AllowedOrigins": ["http://localhost:5173", "https://app.nimbusvault.example"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["content-type", "content-length"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

**TLS-only bucket policy (`s3-tls-only-policy.json`):**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::nimbusvault-files-prod", "arn:aws:s3:::nimbusvault-files-prod/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

**Least-privilege IAM policy for the backend role (`iam-backend-policy.json`) — no delete, no console access:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectLevelAccess",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::nimbusvault-files-prod/*"
    },
    {
      "Sid": "BucketLevelListScoped",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::nimbusvault-files-prod",
      "Condition": { "StringLike": { "s3:prefix": "users/*" } }
    }
  ]
}
```

Dev IAM user provisioning: create user `nimbus-dev-backend` (programmatic access only) → attach the policy above → keys go into local `.env` and GitHub Actions secrets — **never into git or chat**. Root account keeps MFA; budget alarms set on day one.

---

## 5. Development Tasks (sprint board ready)

| ID | Story | Points | Owner |
|---|---|---|---|
| NV-101 | Backend scaffold + env validation + error envelope + logging interceptor | 3 | M1 |
| NV-102 | Prisma schema + migration 0001 + seed script | 2 | M1 |
| NV-103 | Register endpoint (DTO validation, bcrypt cost 12, lowercase email, token pair) | 3 | M1 |
| NV-104 | Login endpoint (generic 401, constant-time compare) | 2 | M1 |
| NV-105 | Refresh rotation + logout denylist + cookie handling | 3 | M1 |
| NV-106 | `/auth/me` + JwtAuthGuard + throttler on auth routes + helmet | 2 | M1 |
| NV-107 | Frontend scaffold: Vite+TS+Tailwind, router shell, Layout/Navbar/Sidebar | 3 | M2 |
| NV-108 | apiClient with request-ID header + 401 refresh-and-retry interceptor | 3 | M2 |
| NV-109 | AuthContext/useAuth + boot session restore | 3 | M2 |
| NV-110 | Register & Login pages (validation, loading/error states, redirect to /dashboard) | 3 | M2 |
| NV-111 | Protected Dashboard page rendering `/auth/me` profile | 2 | M2 |
| NV-112 | Compose stack + Dockerfiles + healthchecks | 3 | M3 |
| NV-113 | CI pipeline (quality + integration jobs) | 3 | M3 |
| NV-114 | AWS foundation artifacts (bucket/CORS/policies/IAM user) documented | 2 | M3 |
| NV-115 | Backend auth test suite (see §6) | 3 | M1 |
| NV-116 | Frontend form component tests + Playwright login/register e2e stubs | 2 | M2 |

## 6. Testing Checklist

### Backend (Jest + Supertest vs real Postgres)

- [ ] Register: valid input → `201`, returns user object **without any hash field**
- [ ] Register: duplicate email differing only in case → `409 EMAIL_TAKEN`
- [ ] Register: weak password / bad email → `400 VALIDATION_ERROR` with per-field details
- [ ] DB assertion: stored row contains a bcrypt hash (`$2b$12$…`), never plaintext
- [ ] Login: correct credentials → `200`; access-token claims decode to `{sub, jti}`, exp ≈ now+15 min
- [ ] Login: unknown email vs wrong password produce **identical** bodies and near-equal response times
- [ ] Refresh rotates — old token fails after use; replaying a rotated token revokes the whole family (`401`)
- [ ] Logout denylists access JTI → `/auth/me` with old token → `401`
- [ ] Protected route without/garbage token → `401` with Doc-04 envelope incl. `requestId`
- [ ] Throttler: 6th login within window → `429 RATE_LIMITED`

### Frontend (Vitest + RTL; Playwright smoke)

- [ ] Register form blocks invalid submits client-side; API errors render in Alert
- [ ] Login success stores context state and navigates to `/dashboard`
- [ ] Reload while refresh cookie valid restores session without login flash
- [ ] Unauthenticated visit to `/dashboard` redirects to `/login`
- [ ] Dashboard renders profile from `/auth/me`; logout clears context
- [ ] No token ever written to `localStorage` (asserted in tests)

## 7. Common Mistakes to Avoid

| # | Mistake | Consequence → Do instead |
|---|---|---|
| 1 | Returning `passwordHash` from any endpoint | Hash leak → map entities through explicit response DTOs |
| 2 | Case-sensitive duplicate emails | `Foo@x.com` + `foo@x.com` both register → normalize to lowercase on save *and* lookup |
| 3 | JWT secret hardcoded/committed | Permanent credential leak → env-injected secrets; `.env` ignored from commit #1; gitleaks in CI |
| 4 | No global exception filter registered | Raw NestJS errors break the Doc-04 envelope → wire filter before building features |
| 5 | Early return when user not found during login | Timing oracle exposes registered emails → always bcrypt-compare against a dummy hash |
| 6 | Tokens in `localStorage` | Any XSS = account takeover → memory + HttpOnly cookie per Security doc |
| 7 | ValidationPipe without `whitelist: true` | Mass assignment via extra JSON fields → whitelist + forbidNonWhitelisted globally |
| 8 | `depends_on` without healthcheck condition | Backend races Postgres startup → compose fails on first run; use §4.3 verbatim |
| 9 | Hand-editing applied migrations | Drift between machines/CI → forward-only `prisma migrate dev` (Doc 03 §7) |
| 10 | Tailwind content globs too narrow | Styles vanish only in production build → glob `./src/**/*.{ts,tsx}` and verify built CSS |
| 11 | React Router v5 habits (`Switch`, `useHistory`) | Runtime crashes on v6 → use `Routes`/`useNavigate` from current docs |
| 12 | Auth tested only against mocked Prisma | Rotation/reuse bugs hide behind mocks → CI integration job runs real Postgres |
| 13 | IAM keys shared in chat / console access enabled | Credential sprawl → programmatic-only user, keys in secrets manager path, rotate quarterly |
| 14 | Starting upload/S3 code "while we are here" | Breaks phase discipline → bucket prep only; first PUT belongs to Phase 2 |

## 8. Phase 1 Exit Checklist

Phase 1 closes only when all are true:

- [ ] Eight acceptance criteria demoable live: open app → register → login → token issued → protected dashboard accessible → user row in DB → runs via Docker → CI green
- [ ] Lint, unit tests, build pass for both services on every PR
- [ ] Integration job applies migrations and runs the auth suite against real Postgres
- [ ] `infrastructure/aws/` holds reviewed CORS/TLS/IAM JSONs; bucket verified private, encrypted, versioned; dev IAM user created least-privilege
- [ ] `.env.example` files complete for both services; no secrets anywhere in git history
- [ ] Docs updated (this plan checked off) and journals carry task notes
