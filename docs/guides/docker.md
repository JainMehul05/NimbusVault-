# Docker

`docker compose up --build` starts six services:

| Service | Address | Notes |
|---|---|---|
| frontend | http://localhost:5173 | nginx: static app, `/api` proxy, security headers |
| backend | http://localhost:3002/api/v1 | API only |
| worker | none | AI indexing and maintenance |
| migrate | none | Applies migrations, then exits |
| postgres | localhost:5433 | pgvector/pgvector:pg16, volume `postgres_data` |
| localstack | localhost:4566 | S3, bucket and CORS created automatically |

All ports bind to 127.0.0.1. Application containers run unprivileged with a read-only filesystem and no capabilities.

**Data.** PostgreSQL persists in its volume. LocalStack's community edition does **not** persist objects across container recreation (that needs LocalStack Pro), so after recreating it files still listed in the database can no longer be downloaded. `docker compose down` keeps volumes; `down -v` deletes them.

**Images.** Build from the repository root: `docker build -f backend/Dockerfile -t nimbusvault-backend .`. The backend image contains the MiniLM model and the RDS certificate bundle and is the one deployed to AWS, where the worker and migrations use the same image with a different command.

**Upgrading from an earlier checkout.** The containers no longer have fixed names and the backend no longer mounts source code; use `npm run dev:backend` for hot reload. Existing `postgres_data` volumes are migrated in place.
