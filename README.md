# NimbusVault AI

## Overview

Cloud-native file storage and management platform.

## Features

### Current Implemented

- **Secure Authentication**: JWT-based authentication with access tokens and refresh token rotation
- **JWT Access Tokens**: Short-lived access tokens (15 min) for API authorization
- **Refresh Token Rotation**: Automatic token rotation with reuse detection for enhanced security
- **Protected Routes**: Route-level authentication guards on both frontend and backend
- **Production-Ready Backend Foundation**: Express.js with TypeScript, Prisma ORM, PostgreSQL
- **Rate Limiting**: API rate limiting with express-rate-limit
- **Security Headers**: Helmet.js for HTTP security headers
- **Input Validation**: Zod schema validation for all API endpoints
- **Structured Logging**: Pino logger with pretty printing for development
- **Health Checks**: Comprehensive health check endpoints
- **Docker Support**: Multi-container Docker Compose setup for local development
- **CI/CD Pipeline**: GitHub Actions workflow for testing and building

### Future (Planned)

- **AWS S3 Storage**: Scalable object storage for file uploads
- **File Management**: Upload, download, organize, version files
- **Sharing**: Secure file/folder sharing with permissions and expiration
- **Semantic Search**: AI-powered search across file contents
- **RAG Assistant**: Retrieval-Augmented Generation for document Q&A

## Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        FE[React Frontend<br/>TypeScript + Vite + Tailwind]
    end

    subgraph "API Layer"
        LB[Load Balancer<br/>nginx/Traefik]
        API[Backend API<br/>Express.js + TypeScript]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL<br/>Primary Database)]
        RD[(Redis<br/>Cache & Sessions)]
    end

    subgraph "Storage Layer"
        S3[AWS S3<br/>File Storage]
    end

    subgraph "AI Layer"
        AI[AI Service<br/>Embeddings + RAG]
    end

    FE --> LB
    LB --> API
    API --> PG
    API --> RD
    API --> S3
    API --> AI
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant Auth Server
    participant Database

    Client->>Auth Server: POST /auth/register {email, password, name}
    Auth Server->>Database: Create User + Hash Password
    Auth Server->>Database: Create Refresh Token Family
    Auth Server-->>Client: {accessToken, refreshToken, refreshTokenFamily}

    Client->>Auth Server: POST /auth/login {email, password}
    Auth Server->>Database: Verify Credentials
    Auth Server->>Database: Create New Refresh Token Family
    Auth Server-->>Client: {accessToken, refreshToken, refreshTokenFamily}

    Client->>API: GET /auth/me Authorization: Bearer <accessToken>
    API->>API: Validate JWT
    API-->>Client: User Profile

    Client->>Auth Server: POST /auth/refresh {refreshToken, tokenFamily}
    Auth Server->>Database: Verify Token + Check Reuse
    Auth Server->>Database: Rotate Token (invalidate old, create new)
    Auth Server-->>Client: {newAccessToken, newRefreshToken, sameTokenFamily}

    Client->>Auth Server: POST /auth/logout {tokenFamily}
    Auth Server->>Database: Revoke Entire Token Family
    Auth Server-->>Client: Success
```

### Database Schema Overview

```mermaid
erDiagram
    USER ||--o{ REFRESH_TOKEN : has
    USER ||--o{ USER_SESSION : has
    USER ||--o{ ACTIVITY_LOG : generates
    USER ||--o{ FOLDER : owns
    USER ||--o{ FILE : owns
    USER ||--o{ SHARE_LINK : creates
    USER ||--o{ PERMISSION : grants

    FOLDER ||--o{ FOLDER : parent
    FOLDER ||--o{ FILE : contains
    FOLDER ||--o{ PERMISSION : has

    FILE ||--o{ SHARE_LINK : has
    FILE ||--o{ PERMISSION : has
    FILE ||--o{ ACTIVITY_LOG : generates

    SHARE_LINK }|--|| FILE : references
    PERMISSION }|--|| USER : grantee
```

## Tech Stack

### Frontend
- **React** 18.2 - UI library
- **TypeScript** 5.3 - Type safety
- **Tailwind CSS** 3.4 - Utility-first styling
- **Vite** 5.1 - Build tool & dev server
- **React Router** 6.22 - Client-side routing
- **Axios** 1.6 - HTTP client
- **Vitest** 1.3 - Unit testing
- **React Testing Library** 14.2 - Component testing

### Backend
- **Node.js** 20+ - Runtime
- **Express.js** 4.18 - Web framework
- **TypeScript** 5.3 - Type safety
- **Prisma ORM** 5.10 - Database ORM
- **PostgreSQL** 16 - Primary database
- **JWT** (jsonwebtoken 9.0) - Token-based auth
- **bcrypt** 5.1 - Password hashing
- **Zod** 3.22 - Schema validation
- **Helmet** 7.1 - Security headers
- **express-rate-limit** 7.1 - Rate limiting
- **Pino** 10.3 - Structured logging
- **Jest** 29.7 - Unit/integration testing
- **Supertest** 6.3 - API testing

### Database
- **PostgreSQL** 16 - Relational database
- **Prisma Migrate** - Schema migrations

### DevOps
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration
- **GitHub Actions** - CI/CD pipeline
- **nginx** (planned) - Reverse proxy

## Local Setup

### Prerequisites

- Node.js >= 20.0.0
- Docker & Docker Compose (recommended)
- OR: PostgreSQL 16+ running locally

### Quick Start with Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/JainMehul05/NimbusVault-.git
cd NimbusVault-

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Access applications
# Frontend: http://localhost:5173
# Backend API: http://localhost:3002/api/v1
# API Health: http://localhost:3002/api/v1/health
```

### Manual Setup (Without Docker)

#### 1. Install Dependencies

```bash
# Install root dependencies (husky, lint-staged)
npm install

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..
```

#### 2. Configure Environment Variables

**Backend** (`backend/.env`):
```env
NODE_ENV=development
PORT=3000
API_PREFIX=v1
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/nimbusvault?schema=public
JWT_ACCESS_SECRET=your-super-secret-access-key-min-32-characters-long
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters-long
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
FRONTEND_URL=http://localhost:5173
```

**Frontend** (`.env` in frontend root):
```env
VITE_API_URL=http://localhost:3002/api/v1
```

#### 3. Database Setup

```bash
# Start PostgreSQL (if not using Docker)
# Ensure PostgreSQL is running on port 5433

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Or push schema directly (development)
npm run db:push
```

#### 4. Start Development Servers

```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

### Environment Variables Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens (min 32 chars) | Yes | - |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (min 32 chars) | Yes | - |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiry | No | 15m |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiry | No | 7d |
| `BCRYPT_ROUNDS` | Password hashing rounds | No | 12 |
| `PORT` | Backend port | No | 3000 |
| `FRONTEND_URL` | CORS origin for frontend | No | http://localhost:5173 |
| `VITE_API_URL` | Frontend API base URL | Yes | - |

## Testing

### Backend Tests

```bash
# Run all backend tests
npm run test:backend

# Run tests with coverage
cd backend && npm run test:cov

# Run tests in watch mode
cd backend && npm run test:watch
```

**Test Coverage Includes:**
- Health check endpoint
- User registration (success, duplicate email, validation)
- User login (success, wrong password, non-existent user)
- JWT protected routes (valid token, missing token, invalid token)
- Refresh token rotation (success, token reuse detection)
- Logout (success, token invalidation after logout)

### Frontend Tests

```bash
# Run all frontend tests
npm run test:frontend

# Run tests with UI
cd frontend && npm run test:ui

# Run tests in watch mode
cd frontend && npm run test
```

**Test Coverage Includes:**
- Login page (form validation, submission, error handling)
- Register page (form validation, submission, error handling)
- Auth context (state management, token persistence)

### Docker Tests

```bash
# Build all images
npm run docker:build

# Run containers in background
npm run docker:up

# Run backend tests inside container
docker exec nimbusvault-backend npm test

# Run frontend tests inside container
docker exec nimbusvault-frontend npm run test:run

# View logs
npm run docker:logs

# Stop containers
npm run docker:down
```

### Test Commands Summary

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (backend + frontend) |
| `npm run test:backend` | Run backend tests only |
| `npm run test:frontend` | Run frontend tests only |
| `npm run test:cov` | Backend tests with coverage report |

## Project Roadmap

### Phase 0: Architecture & Planning ✅ **COMPLETED**
- [x] Software Requirements Specification (SRS)
- [x] System Architecture Design
- [x] Database Schema Design
- [x] API Specification (OpenAPI)
- [x] Technology Stack Selection
- [x] Security Architecture
- [x] Scalability Planning
- [x] Observability Strategy
- [x] Disaster Recovery Plan
- [x] Testing Strategy
- [x] Team Structure & Workflow
- [x] Project Roadmap

### Phase 1: Foundation & Authentication ✅ **COMPLETED**
- [x] Project Structure Setup (Monorepo with npm workspaces)
- [x] Backend: Express + TypeScript + Prisma + PostgreSQL
- [x] Frontend: React + TypeScript + Vite + Tailwind
- [x] Docker Compose Development Environment
- [x] Database Schema Implementation (Users, Sessions, Tokens, Files, Folders, Sharing, Activity Logs)
- [x] Authentication Module (Register, Login, JWT, Refresh Tokens)
- [x] Refresh Token Rotation with Reuse Detection
- [x] Protected Routes (Backend Middleware + Frontend Guards)
- [x] Input Validation (Zod Schemas)
- [x] Error Handling & Standardized Responses
- [x] Security Hardening (Helmet, Rate Limiting, CORS)
- [x] Structured Logging (Pino)
- [x] Health Check Endpoints
- [x] Comprehensive Test Suite (Backend + Frontend)
- [x] CI/CD Pipeline (GitHub Actions)
- [x] Documentation (Architecture, API, Database, Testing, Setup)

### Phase 2: Cloud Storage & File Management 🔄 **PLANNED**
- [ ] AWS S3 Integration (Presigned URLs, Multipart Upload)
- [ ] File Upload/Download API
- [ ] Folder Management (CRUD, Hierarchy)
- [ ] File Metadata & Search
- [ ] File Versioning
- [ ] Storage Quota Enforcement
- [ ] Frontend: File Manager UI
- [ ] Frontend: Drag & Drop Upload
- [ ] Frontend: Folder Navigation

### Phase 3: Collaboration & Sharing 🔄 **PLANNED**
- [ ] Share Links (Create, Revoke, Password Protection, Expiry)
- [ ] Permission System (Viewer, Editor)
- [ ] Real-time Notifications (WebSockets)
- [ ] Activity Feed
- [ ] Team/Workspaces
- [ ] Frontend: Sharing UI
- [ ] Frontend: Collaborators Management

### Phase 4: Semantic Search & RAG Assistant 🔄 **PLANNED**
- [ ] Document Processing Pipeline
- [ ] Text Extraction (PDF, Images, Documents)
- [ ] Vector Embeddings Generation
- [ ] Vector Database Integration (pgvector / Pinecone)
- [ ] Semantic Search API
- [ ] RAG Query Engine
- [ ] AI Assistant Chat Interface
- [ ] Frontend: Search UI
- [ ] Frontend: AI Chat Interface

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

- **Repository**: https://github.com/JainMehul05/NimbusVault-
- **Issues**: https://github.com/JainMehul05/NimbusVault-/issues