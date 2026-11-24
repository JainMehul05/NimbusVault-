-- Phase 1–3 security fixes + Phase 4 AI document intelligence.
-- Additive only: no existing column, table or row is dropped.
-- Requires the pgvector extension (docker image pgvector/pgvector:pg16).

-- Extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiSummaryStatus" AS ENUM ('NONE', 'READY', 'FAILED', 'UNAVAILABLE');

-- AlterEnum
ALTER TYPE "AiStatus" ADD VALUE 'UNSUPPORTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'folder_rename';
ALTER TYPE "ActivityAction" ADD VALUE 'folder_move';
ALTER TYPE "ActivityAction" ADD VALUE 'share_update';
ALTER TYPE "ActivityAction" ADD VALUE 'share_link_create';
ALTER TYPE "ActivityAction" ADD VALUE 'share_link_revoke';
ALTER TYPE "ActivityAction" ADD VALUE 'ai_reindex';

-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "tokenLookup" TEXT;

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "targetOwnerId" TEXT;

-- CreateTable
CREATE TABLE "document_indexes" (
    "fileId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "extractor" TEXT,
    "textContent" TEXT,
    "textLength" INTEGER,
    "textTruncated" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "sourceChecksum" TEXT,
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "summary" TEXT,
    "summaryStatus" "AiSummaryStatus" NOT NULL DEFAULT 'NONE',
    "summaryModel" TEXT,
    "summaryCoverage" DOUBLE PRECISION,
    "summaryError" TEXT,
    "summaryGeneratedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_indexes_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "tokenEstimate" INTEGER NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_fileId_generation_idx" ON "document_chunks"("fileId", "generation");

-- CreateIndex
CREATE INDEX "document_chunks_embeddingModel_idx" ON "document_chunks"("embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_fileId_generation_chunkIndex_key" ON "document_chunks"("fileId", "generation", "chunkIndex");

-- CreateIndex
CREATE INDEX "ai_jobs_status_runAfter_idx" ON "ai_jobs"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ai_jobs_fileId_idx" ON "ai_jobs"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenLookup_key" ON "share_links"("tokenLookup");

-- CreateIndex
CREATE INDEX "activity_logs_targetOwnerId_createdAt_idx" ON "activity_logs"("targetOwnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "document_indexes" ADD CONSTRAINT "document_indexes_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: attribute existing events to the owner of the affected resource so owners
-- can see them in their activity feed (actor stays unchanged).
UPDATE "activity_logs" a SET "targetOwnerId" = f."ownerId"
  FROM "files" f WHERE a."resourceType" = 'FILE' AND a."resourceId" = f."id" AND a."targetOwnerId" IS NULL;
UPDATE "activity_logs" a SET "targetOwnerId" = d."ownerId"
  FROM "folders" d WHERE a."resourceType" = 'FOLDER' AND a."resourceId" = d."id" AND a."targetOwnerId" IS NULL;
UPDATE "activity_logs" a SET "targetOwnerId" = f."ownerId"
  FROM "share_links" s JOIN "files" f ON f."id" = s."fileId"
  WHERE a."resourceType" = 'SHARE_LINK' AND a."resourceId" = s."id" AND a."targetOwnerId" IS NULL;
