# Local development

Requirements: Node.js 22 (20.19+ works), npm, Git. Docker Desktop for PostgreSQL and LocalStack.

```bash
git clone https://github.com/JainMehul05/NimbusVault-.git && cd NimbusVault-
npm ci
docker compose up -d postgres localstack
cp backend/.env.example backend/.env
npm run db:generate
npm run migrate --workspace=backend      # after: npm run build --workspace=backend
npm run dev:backend                      # http://localhost:3000/api/v1
npm run dev:frontend                     # http://localhost:5173 (proxies /api)
```

Everything in containers instead: `docker compose up --build`, then http://localhost:5173.

## Without Docker (what was used to verify this release on Windows)

PostgreSQL with pgvector can be replaced for development by PGlite, and LocalStack by moto:

```bash
mkdir ../nv-services && cd ../nv-services && npm init -y
npm i @electric-sql/pglite @electric-sql/pglite-socket @electric-sql/pglite-pgvector
python -m venv moto && moto/Scripts/pip install "moto[s3,server]"      # moto/bin/pip on macOS/Linux
moto/Scripts/moto_server -H 127.0.0.1 -p 4566 &
curl -X PUT http://localhost:4566/nimbusvault
```

Serve PGlite on port 5433 with a ten-line script: create it with `extensions: { vector }` and pass it to `PGLiteSocketServer`. Use
`DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable&connection_limit=1&pgbouncer=true"`.
PGlite has a single connection, so it does **not** prove concurrency behaviour; CI does that on real PostgreSQL.

## Tests

```bash
npm run test:prepare --workspace=backend   # creates and migrates nimbusvault_test
npm run test:backend
npm run test:frontend
npm run build && npm run test:e2e          # first: npx playwright install chromium (in e2e/)
npm test --workspace=infra
npm run lint && npm run typecheck --workspace=backend
```

Backend suites delete all rows when they finish, so they refuse any database whose name does not contain `test`. (`ALLOW_DESTRUCTIVE_TESTS=true` overrides this for throwaway engines such as PGlite.)
