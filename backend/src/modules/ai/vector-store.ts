import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@database/prisma';
import { accessibleFilesCte } from '@common/authorization';
import type { TextChunk } from './chunking';

type Db = PrismaClient | Prisma.TransactionClient;

/** pgvector literal. Values are numbers we produced, so this cannot inject SQL. */
export const toVectorLiteral = (v: number[]): string => {
  for (const x of v) if (!Number.isFinite(x)) throw new Error('Embedding contains a non-finite value');
  return `[${v.join(',')}]`;
};

export interface ChunkHit {
  chunkId: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
  filename: string;
  mimeType: string;
  folderId: string | null;
  ownerId: string;
}

export class VectorStore {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async insertChunks(
    db: Db,
    fileId: string,
    generation: number,
    modelId: string,
    chunks: TextChunk[],
    vectors: number[][]
  ): Promise<void> {
    const BATCH = 100;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const rows = chunks.slice(i, i + BATCH).map((c, j) =>
        Prisma.sql`(${randomUUID()}, ${fileId}, ${generation}, ${c.index}, ${c.content}, ${c.charStart}, ${c.charEnd},
          ${c.pageStart}, ${c.pageEnd}, ${c.tokenEstimate}, ${modelId}, ${toVectorLiteral(vectors[i + j])}::vector)`
      );
      await db.$executeRaw`
        INSERT INTO "document_chunks"
          ("id", "fileId", "generation", "chunkIndex", "content", "charStart", "charEnd",
           "pageStart", "pageEnd", "tokenEstimate", "embeddingModel", "embedding")
        VALUES ${Prisma.join(rows)}`;
    }
  }

  async deleteForFiles(db: Db, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await db.$executeRaw`DELETE FROM "document_chunks" WHERE "fileId" IN (${Prisma.join(fileIds)})`;
  }

  /**
   * Cosine-similarity search restricted, *inside the query*, to:
   *  - files the user can currently read (owned / shared / inherited — see accessibleFilesCte),
   *  - the file's current index generation (stale chunks are never returned),
   *  - vectors produced by the currently configured embedding model.
   * Optionally narrowed to `fileIds`. Results are capped per file for diversity.
   */
  async search(params: {
    userId: string;
    queryVector: number[];
    modelId: string;
    limit: number;
    minScore: number;
    fileIds?: string[];
    perFileLimit?: number;
  }): Promise<ChunkHit[]> {
    const { userId, queryVector, modelId, limit, minScore, fileIds, perFileLimit = 3 } = params;
    if (fileIds && fileIds.length === 0) return [];
    const vec = toVectorLiteral(queryVector);

    const rows = await this.prismaClient.$queryRaw<Array<ChunkHit & { rank: bigint }>>(Prisma.sql`
      ${accessibleFilesCte(userId)},
      scored AS (
        SELECT c."id" AS "chunkId", c."fileId", c."chunkIndex", c."content", c."pageStart", c."pageEnd",
               (1 - (c."embedding" <=> ${vec}::vector))::float8 AS "score",
               f."filename", f."mimeType", f."folderId", f."ownerId"
        FROM "document_chunks" c
        JOIN accessible_files a ON a.id = c."fileId"
        JOIN "files" f ON f."id" = c."fileId" AND f."deletedAt" IS NULL AND f."aiStatus" = 'INDEXED'::"AiStatus"
        JOIN "document_indexes" d ON d."fileId" = c."fileId" AND d."generation" = c."generation"
        WHERE c."embeddingModel" = ${modelId} AND c."embedding" IS NOT NULL
          ${fileIds ? Prisma.sql`AND c."fileId" IN (${Prisma.join(fileIds)})` : Prisma.empty}
        ORDER BY c."embedding" <=> ${vec}::vector
        LIMIT ${Math.max(limit * 4, 40)}
      ),
      ranked AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s."fileId" ORDER BY s."score" DESC) AS rank FROM scored s
      )
      SELECT * FROM ranked
      WHERE rank <= ${perFileLimit} AND "score" >= ${minScore}
      ORDER BY "score" DESC
      LIMIT ${limit}`);

    return rows.map(({ rank: _rank, ...hit }) => ({ ...hit, score: Number(hit.score) }));
  }
}

export const vectorStore = new VectorStore();
