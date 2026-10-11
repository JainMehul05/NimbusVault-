# Database Design

## Overview

This document describes the PostgreSQL database schema for NimbusVault Phase 1, managed via Prisma ORM.

## Schema Diagram

```
┌─────────────────┐       ┌──────────────────────┐
│      User       │       │    RefreshToken      │
├─────────────────┤       ├──────────────────────┤
│ id (PK)         │◄──────│ id (PK)              │
│ name            │       │ userId (FK)          │
│ email (UK)      │       │ tokenHash            │
│ passwordHash    │       │ expiresAt            │
│ createdAt       │       │ createdAt            │
│ updatedAt       │       │ revokedAt            │
│                 │       │ tokenFamily          │
└─────────────────┘       └──────────────────────┘
        │                          │
        │ 1:N                      │ N:1
        ▼                          ▼
```

## Tables

### User

Stores user account information.

```prisma
model User {
  id            String         @id @default(uuid())
  name          String
  email         String         @unique
  passwordHash  String
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  refreshTokens RefreshToken[]

  @@index([email])
  @@map("users")
}
```

#### Columns

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, Default: uuid() | Unique identifier |
| name | String | Not Null | User's display name |
| email | String | Not Null, Unique | User's email (login) |
| passwordHash | String | Not Null | Bcrypt hash |
| createdAt | DateTime | Not Null, Default: now() | Account creation |
| updatedAt | DateTime | Not Null, Auto-update | Last modification |

#### Indexes
- **Primary Key**: `id`
- **Unique**: `email` (enforces unique accounts)
- **Index**: `email` (optimizes login lookups)

### RefreshToken

Stores hashed refresh tokens for authentication.

```prisma
model RefreshToken {
  id          String   @id @default(uuid())
  userId      String
  tokenHash   String
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  revokedAt   DateTime?
  tokenFamily String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenFamily])
  @@map("refresh_tokens")
}
```

#### Columns

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, Default: uuid() | Unique identifier |
| userId | UUID | FK → User.id, Cascade Delete | Token owner |
| tokenHash | String | Not Null | Bcrypt hash of raw token |
| expiresAt | DateTime | Not Null | Token expiration |
| createdAt | DateTime | Not Null, Default: now() | Issuance time |
| revokedAt | DateTime | Nullable | Revocation time |
| tokenFamily | String | Not Null | Rotation group identifier |

#### Indexes
- **Primary Key**: `id`
- **Index**: `userId` (user's active tokens)
- **Index**: `tokenFamily` (rotation/revocation lookups)

#### Foreign Key
- `userId` → `User.id` (ON DELETE CASCADE)

## Design Decisions

### UUID Primary Keys
- **Pros**: Globally unique, no enumeration, distributed-friendly
- **Cons**: Larger storage, slightly slower than integers
- **Decision**: UUIDs for all entities to support future distributed architecture

### Password Hashing
- **Algorithm**: bcrypt
- **Rounds**: 12 (configurable via `BCRYPT_ROUNDS`)
- **Storage**: Only hash stored, never plaintext

### Refresh Token Storage
- **Raw Token**: Never stored in database
- **Hash**: bcrypt hash with same rounds as passwords
- **Verification**: Constant-time comparison via bcrypt.compare()

### Token Families
- **Purpose**: Group related tokens for rotation and revocation
- **Generation**: UUID v4 on login
- **Lifecycle**: 
  1. Created on login
  2. New token added on each refresh (same family)
  3. Entire family revoked on logout or reuse detection

### Soft Revocation
- **Pattern**: `revokedAt` timestamp instead of hard delete
- **Benefits**: Audit trail, debugging, cleanup jobs
- **Query**: Active tokens = `revokedAt IS NULL AND expiresAt > NOW()`

### Cascade Delete
- **User Deletion**: Automatically removes all refresh tokens
- **Implementation**: Prisma `@relation(onDelete: Cascade)`

## Migrations

### Initial Migration
```bash
npx prisma migrate dev --name init
```

Generates:
```sql
-- CreateEnum not needed (no enums in Phase 1)

-- CreateTable: users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateTable: refresh_tokens
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "tokenFamily" TEXT NOT NULL,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_tokenFamily_idx" ON "refresh_tokens"("tokenFamily");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### Migration Commands

```bash
# Development: Create and apply
npx prisma migrate dev --name descriptive_name

# Production: Apply pending
npx prisma migrate deploy

# Reset (dev only)
npx prisma migrate reset

# Status
npx prisma migrate status

# Diff (schema vs database)
npx prisma migrate diff
```

## Prisma Client Usage

### Singleton Pattern
```typescript
// src/database/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

### Common Queries

#### Create User
```typescript
const user = await prisma.user.create({
  data: {
    name: 'John',
    email: 'john@example.com',
    passwordHash: await bcrypt.hash('password', 12),
  },
});
```

#### Find User by Email
```typescript
const user = await prisma.user.findUnique({
  where: { email: 'john@example.com' },
});
```

#### Find Active Refresh Tokens
```typescript
const tokens = await prisma.refreshToken.findMany({
  where: {
    tokenFamily: 'family-uuid',
    revokedAt: null,
    expiresAt: { gt: new Date() },
  },
});
```

#### Create Refresh Token
```typescript
const token = await prisma.refreshToken.create({
  data: {
    userId: user.id,
    tokenHash: await bcrypt.hash(rawToken, 12),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    tokenFamily: 'family-uuid',
  },
});
```

#### Revoke Token Family
```typescript
await prisma.refreshToken.updateMany({
  where: { tokenFamily: 'family-uuid' },
  data: { revokedAt: new Date() },
});
```

#### Revoke Single Token
```typescript
await prisma.refreshToken.update({
  where: { id: 'token-id' },
  data: { revokedAt: new Date() },
});
```

#### Cleanup Expired Tokens (Cron Job)
```typescript
await prisma.refreshToken.deleteMany({
  where: {
    OR: [
      { expiresAt: { lt: new Date() } },
      { revokedAt: { not: null, lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    ],
  },
});
```

## Performance Considerations

### Indexing Strategy
- `users.email`: Unique + Index for login lookups
- `refresh_tokens.userId`: User's token queries
- `refresh_tokens.tokenFamily`: Rotation/revocation queries

### Query Optimization
- Use `findUnique` for PK/unique lookups
- Select only needed fields with `select`
- Paginate large result sets

### Connection Pooling
- Prisma manages pool automatically
- Configure via `DATABASE_URL`:
  ```
  postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=10
  ```

## Backup and Recovery

### Logical Backup
```bash
# Backup
pg_dump -h localhost -U postgres -d nimbusvault > backup.sql

# Restore
psql -h localhost -U postgres -d nimbusvault < backup.sql
```

### Point-in-Time Recovery
- Enable WAL archiving in PostgreSQL
- Use `pg_basebackup` for physical backups
- Configure `recovery_target_time` for PITR

## Monitoring

### Key Metrics
- Connection count
- Query latency
- Table/index bloat
- Slow queries

### Prisma Logging
```typescript
log: ['query', 'info', 'warn', 'error'] // Development
log: ['error'] // Production
```

## Future Schema Evolution (Phase 2+)

### Planned Tables
```prisma
model File {
  id        String   @id @default(uuid())
  userId    String
  folderId  String?
  name      String
  mimeType  String
  size      BigInt
  s3Key     String
  checksum  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  folder    Folder?  @relation(fields: [folderId], references: [id])

  @@index([userId])
  @@index([folderId])
  @@map("files")
}

model Folder {
  id        String   @id @default(uuid())
  userId    String
  parentId  String?
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  parent    Folder?  @relation("FolderHierarchy", fields: [parentId], references: [id])
  children  Folder[] @relation("FolderHierarchy")
  files     File[]

  @@index([userId])
  @@index([parentId])
  @@map("folders")
}

model ShareLink {
  id        String   @id @default(uuid())
  fileId    String
  userId    String
  token     String   @unique
  expiresAt DateTime?
  createdAt DateTime @default(now())
  file      File     @relation(fields: [fileId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([token])
  @@map("share_links")
}
```

## Troubleshooting

### Common Issues

#### P1001: Can't reach database
- Check PostgreSQL is running
- Verify `DATABASE_URL` format
- Check firewall/network

#### P2003: Foreign key constraint failed
- Ensure referenced user exists
- Check cascade delete behavior

#### P2002: Unique constraint failed
- Duplicate email on registration
- Handle in application code

#### Migration fails
- Check for pending migrations: `npx prisma migrate status`
- Resolve conflicts manually if needed
- Use `prisma migrate resolve` for applied migrations

### Debugging
```bash
# View generated SQL
DEBUG="prisma:query" npm run start:dev

# Prisma Studio (GUI)
npx prisma studio

# Raw SQL
npx prisma db execute --stdin < query.sql
```