# Phase 1 Setup Guide

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Git
- PostgreSQL 16 (if running without Docker)

## Quick Start with Docker

### 1. Clone Repository
```bash
git clone <repository-url>
cd NimbusVault
```

### 2. Start All Services
```bash
docker compose up -d
```

### 3. Verify Services
- Backend: http://localhost:3000/api/v1/health
- Frontend: http://localhost:5173
- Database: localhost:5432

### 4. Run Database Migrations
```bash
docker compose exec backend npx prisma migrate dev
```

## Manual Development Setup

### Backend

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Start PostgreSQL (if not using Docker)**
   ```bash
   # Using Docker for just the database
   docker run -d \
     --name nimbusvault-postgres \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=nimbusvault \
     -p 5432:5432 \
     -v postgres_data:/var/lib/postgresql/data \
     postgres:16-alpine
   ```

5. **Generate Prisma Client**
   ```bash
   npx prisma generate
   ```

6. **Run Migrations**
   ```bash
   npx prisma migrate dev
   ```

7. **Start Development Server**
   ```bash
   npm run start:dev
   ```

### Frontend

1. **Navigate to frontend directory**
   ```bash
   cd frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment (optional)**
   ```bash
   # Create .env file if needed
   echo "VITE_API_URL=http://localhost:3000/api/v1" > .env
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## Environment Variables

### Backend (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| NODE_ENV | Environment | development |
| PORT | Server port | 3000 |
| API_PREFIX | API version prefix | api/v1 |
| DATABASE_URL | PostgreSQL connection string | Required |
| JWT_ACCESS_SECRET | Access token signing key | Required (min 32 chars) |
| JWT_REFRESH_SECRET | Refresh token signing key | Required (min 32 chars) |
| JWT_ACCESS_EXPIRES_IN | Access token TTL | 15m |
| JWT_REFRESH_EXPIRES_IN | Refresh token TTL | 7d |
| BCRYPT_ROUNDS | Password hash rounds | 12 |
| FRONTEND_URL | CORS origin | http://localhost:5173 |

### Frontend (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| VITE_API_URL | Backend API base URL | http://localhost:3000/api/v1 |

## Database Management

### Prisma Commands

```bash
# Generate client after schema changes
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name migration_name

# Apply pending migrations (production)
npx prisma migrate deploy

# Push schema without migration (development)
npx prisma db push

# Open Prisma Studio (GUI)
npx prisma studio

# Reset database (development only)
npx prisma migrate reset

# Seed database
npx prisma db seed
```

### Database Seeding

Create `prisma/seed.ts` for initial data:

```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);
  
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@example.com',
      passwordHash,
    },
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
```

Add to `package.json`:
```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

## Testing

### Backend Tests

```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run in watch mode
npm run test:watch

# Run specific test file
npm test -- auth.test.ts
```

### Frontend Tests

```bash
cd frontend

# Run all tests
npm run test:run

# Run with UI
npm run test:ui

# Run in watch mode
npm test
```

## Linting

### Backend
```bash
cd backend
npm run lint
```

### Frontend
```bash
cd frontend
npm run lint
```

## Building for Production

### Backend
```bash
cd backend
npm run build
npm run start:prod
```

### Frontend
```bash
cd frontend
npm run build
# Output in dist/ directory
```

### Docker Production Build
```bash
# Build images
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Database Connection Issues

1. **Check PostgreSQL is running**
   ```bash
   docker compose ps postgres
   ```

2. **Verify connection string**
   ```bash
   docker compose exec backend npx prisma db pull
   ```

3. **Reset database**
   ```bash
   docker compose down -v
   docker compose up -d
   ```

### Port Conflicts

- Backend: Change `PORT` in `.env`
- Frontend: Change port in `vite.config.ts`
- Database: Change port mapping in `docker-compose.yml`

### Prisma Issues

1. **Clear Prisma cache**
   ```bash
   rm -rf node_modules/.prisma
   npx prisma generate
   ```

2. **Regenerate after schema changes**
   ```bash
   npx prisma generate
   ```

### Frontend Build Issues

1. **Clear Vite cache**
   ```bash
   rm -rf node_modules/.vite
   npm run dev
   ```

2. **Reinstall dependencies**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

## IDE Configuration

### VS Code Extensions (Recommended)

- ESLint
- Prettier
- Prisma
- Tailwind CSS IntelliSense
- TypeScript Hero

### Settings (`.vscode/settings.json`)

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "prisma.prismaFmtBinPath": ""
}
```

## Git Workflow

### Branch Naming
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code improvements

### Commit Messages
Follow Conventional Commits:
```
feat(auth): add refresh token rotation
fix(users): handle duplicate email error
docs: update setup guide
```

### Pull Request Process

1. Create feature branch from `develop`
2. Implement changes with tests
3. Run linting and tests locally
4. Push branch and create PR to `develop`
5. Code review required
6. CI must pass
7. Squash and merge

## Useful Commands

### Backend
```bash
# Check TypeScript compilation
npx tsc --noEmit

# View Prisma schema
cat prisma/schema.prisma

# Database studio
npx prisma studio
```

### Frontend
```bash
# Type check
npx tsc --noEmit

# Preview production build
npm run preview
```

### Docker
```bash
# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Execute commands in container
docker compose exec backend sh
docker compose exec frontend sh

# Clean up
docker compose down -v --remove-orphans
```