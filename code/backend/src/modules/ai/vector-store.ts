import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@database/prisma';
import { config } from '@config/index';
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

type SearchRow = ChunkHit & { rank: bigint };

/** The HNSW index covers 384-dimension vectors (see the phase5_hardening migration). */
const ANN_DIMENSIONS = 384;

export class VectorStore {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  private iterativeScan: Promise<boolean> | null = null;

  /** pgvector 0.8 added iterative scans, without which a filtered HNSW search can miss results. */
  private supportsIterativeScan(): Promise<boolean> {
    return (this.iterativeScan ??= this.prismaClient.$queryRaw<Array<{ extversion: string }>>`
      SELECT "extversion" FROM pg_extension WHERE "extname" = 'vector'`
      .then((rows) => {
        const [major = 0, minor = 0] = (rows[0]?.extversion ?? '').split('.').map(Number);
        return major > 0 || minor >= 8;
      })
      .catch(() => {
        this.iterativeScan = null;
        return false;
      }));
  }

  /**
   * Exact search is both fastest and perfectly accurate while a user can reach few chunks. The
   * HNSW index only pays off for very large libraries.
   */
  private async shouldUseAnn(userId: string, modelId: string, dimensions: number): Promise<boolean> {
    if (dimensions !== ANN_DIMENSIONS || !modelId.endsWith(`@${ANN_DIMENSIONS}`)) return false;
    const threshold = config.ai.embedding.annThreshold;
    const rows = await this.prismaClient.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      ${accessibleFilesCte(userId)}
      SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM "document_chunks" c JOIN accessible_files a ON a.id = c."fileId"
        WHERE c."embeddingModel" = ${modelId} LIMIT ${threshold + 1}
      ) t`);
    return Number(rows[0]?.n ?? 0) > threshold && (await this.supportsIterativeScan());
  }

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
   * The same filters apply whether the scan is exact or uses the HNSW index.
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
    const ann = !fileIds && (await this.shouldUseAnn(userId, modelId, queryVector.length));
    // The index is on an expression, so the query must use exactly that expression and predicate.
    const distance = ann
      ? Prisma.sql`(c."embedding"::vector(384) <=> ${vec}::vector(384))`
      : Prisma.sql`(c."embedding" <=> ${vec}::vector)`;

    const query = Prisma.sql`
      ${accessibleFilesCte(userId)},
      scored AS (
        SELECT c."id" AS "chunkId", c."fileId", c."chunkIndex", c."content", c."pageStart", c."pageEnd",
               (1 - ${distance})::float8 AS "score",
               f."filename", f."mimeType", f."folderId", f."ownerId"
        FROM "document_chunks" c
        JOIN accessible_files a ON a.id = c."fileId"
        JOIN "files" f ON f."id" = c."fileId" AND f."deletedAt" IS NULL AND f."aiStatus" = 'INDEXED'::"AiStatus"
        JOIN "document_indexes" d ON d."fileId" = c."fileId" AND d."generation" = c."generation"
        WHERE c."embeddingModel" = ${modelId} AND c."embedding" IS NOT NULL
          ${ann ? Prisma.sql`AND c."embeddingModel" LIKE '%@384'` : Prisma.empty}
          ${fileIds ? Prisma.sql`AND c."fileId" IN (${Prisma.join(fileIds)})` : Prisma.empty}
        ORDER BY ${distance}
        LIMIT ${Math.max(limit * 4, 40)}
      ),
      ranked AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s."fileId" ORDER BY s."score" DESC) AS rank FROM scored s
      )
      SELECT * FROM ranked
      WHERE rank <= ${perFileLimit} AND "score" >= ${minScore}
      ORDER BY "score" DESC
      LIMIT ${limit}`;

    const rows = ann
      ? await this.prismaClient.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = 'strict_order'`;
          return tx.$queryRaw<SearchRow[]>(query);
        })
      : await this.prismaClient.$queryRaw<SearchRow[]>(query);

    return rows.map(({ rank: _rank, ...hit }) => ({ ...hit, score: Number(hit.score) }));
  }
}

export const vectorStore = new VectorStore();
