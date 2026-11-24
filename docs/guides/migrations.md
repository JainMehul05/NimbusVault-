# Database migrations

| Migration | Purpose |
|---|---|
| `0_init` | Baseline schema |
| `20261123000000_security_fixes_and_ai_documents` | AI tables, pgvector, activity owner back-fill |
| `20261125000000_phase5_hardening` | Presigned-upload columns, live-only folder name index, storage check constraints, HNSW index, lower-case e-mail index, new activity types |

```bash
npm run migrate --workspace=backend                          # apply (production-safe, idempotent)
cd backend && npx prisma migrate status
cd backend && npx prisma migrate dev --name my_change        # create, development only
```

Requires PostgreSQL 16 with pgvector 0.5+ (0.8+ for the large-library search path).

**What the Phase 5 migration changes in existing data.** Nothing is deleted. Live top-level folders of one owner with identical names get a suffix (`Docs (1a2b3c4d)`); negative storage usage becomes 0. The unique index on folder names is replaced by one that ignores deleted folders.

**Upgrade test.** `node backend/scripts/test-upgrade.cjs <empty test database url>` migrates a populated older schema and checks that every row survives. CI runs it on real PostgreSQL, plus a fresh install and a drift check.

**Databases created with `prisma db push`:** back up, then `npx prisma migrate resolve --applied 0_init` before migrating.

Rules: additive changes only, never edit an applied migration, no `migrate reset` or `db push` against real data.
