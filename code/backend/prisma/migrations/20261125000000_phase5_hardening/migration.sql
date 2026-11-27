-- Phase 5 hardening. No table, column or row is dropped. One index (folders unique name) is
-- replaced by a stricter one that ignores soft-deleted folders.

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'folder_restore';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'file_purge';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'folder_purge';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'auth_session_revoke';

-- Presigned uploads: quota is reserved against a file row before the URL is issued.
ALTER TABLE "files" ADD COLUMN "stagingKey" TEXT;
ALTER TABLE "files" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "files_stagingKey_key" ON "files"("stagingKey");
CREATE INDEX "files_folderId_idx" ON "files"("folderId");
CREATE INDEX "files_status_uploadExpiresAt_idx" ON "files"("status", "uploadExpiresAt");
CREATE INDEX "files_deletedAt_idx" ON "files"("deletedAt");
CREATE INDEX "folders_ownerId_deletedAt_idx" ON "folders"("ownerId", "deletedAt");

-- Folder names: the old unique index counted deleted folders (so a deleted name could never be
-- reused) and never applied at the top level (NULL parent). Disambiguate any live top-level
-- duplicates that slipped through, then enforce uniqueness for live folders at every level.
UPDATE "folders" f SET "name" = f."name" || ' (' || left(f."id", 8) || ')'
  FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "ownerId", COALESCE("parentFolderId", ''), "name" ORDER BY "createdAt", "id"
    ) AS rn
    FROM "folders" WHERE "deletedAt" IS NULL
  ) d
  WHERE d."id" = f."id" AND d.rn > 1;
DROP INDEX "folders_ownerId_parentFolderId_name_key";
CREATE UNIQUE INDEX "folders_live_name_key"
  ON "folders" ("ownerId", (COALESCE("parentFolderId", '')), "name") WHERE "deletedAt" IS NULL;

-- Storage accounting can never go negative.
UPDATE "users" SET "storageUsedBytes" = 0 WHERE "storageUsedBytes" < 0;
ALTER TABLE "users" ADD CONSTRAINT "users_storageUsedBytes_nonnegative" CHECK ("storageUsedBytes" >= 0);
ALTER TABLE "files" ADD CONSTRAINT "files_sizeBytes_nonnegative" CHECK ("sizeBytes" >= 0) NOT VALID;

-- Approximate-nearest-neighbour index for the default local model (384 dimensions). The
-- "embedding" column is dimension-agnostic, so the index casts and is limited to 384-dim models.
CREATE INDEX "document_chunks_embedding_384_hnsw"
  ON "document_chunks" USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
  WHERE "embeddingModel" LIKE '%@384';

-- Case-insensitive account lookup (not unique: pre-existing accounts may differ only by case).
CREATE INDEX "users_lower_email_idx" ON "users" (lower("email"));
