import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '@database/prisma';
import { AppError, ErrorCodes } from '@common/errors';
import { logger, createRequestLogger } from '@common/logger';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Reserves storage. The check and the increment are one conditional UPDATE, so concurrent
 * uploads cannot together exceed the quota.
 */
export async function reserveQuota(db: Db, userId: string, sizeBytes: bigint, requestId?: string): Promise<void> {
  const updated = await db.$executeRaw`
    UPDATE "users" SET "storageUsedBytes" = "storageUsedBytes" + ${sizeBytes}, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" = ${userId} AND "storageUsedBytes" + ${sizeBytes} <= "storageQuotaBytes"`;
  if (updated > 0) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { storageQuotaBytes: true, storageUsedBytes: true },
  });
  if (!user) throw AppError.notFound('User not found', ErrorCodes.NOT_OWNER);

  const log = requestId ? createRequestLogger(requestId) : logger;
  const details = {
    quota: user.storageQuotaBytes.toString(),
    used: user.storageUsedBytes.toString(),
    requested: sizeBytes.toString(),
  };
  log.warn({ userId, ...details }, 'Quota exceeded');
  throw AppError.forbidden('Storage quota exceeded', ErrorCodes.QUOTA_EXCEEDED, details);
}

/** Returns storage. Clamped at zero so accounting can never go negative. */
export async function releaseQuota(db: Db, userId: string, sizeBytes: bigint): Promise<void> {
  await db.$executeRaw`
    UPDATE "users" SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${sizeBytes}) WHERE "id" = ${userId}`;
}

/**
 * Recomputes usage from the files that actually count (live, including in-flight presigned
 * reservations) and corrects drift, e.g. after a crash between reserving and recording.
 * Users who changed in the last hour are skipped: a direct upload may be in progress.
 */
export async function reconcileQuota(db: PrismaClient = prisma): Promise<number> {
  return db.$executeRaw`
    UPDATE "users" u SET "storageUsedBytes" = a.actual
    FROM (
      SELECT u2."id", COALESCE(SUM(f."sizeBytes") FILTER (WHERE f."deletedAt" IS NULL AND f."status" <> 'FAILED'::"FileStatus"), 0)::bigint AS actual
      FROM "users" u2 LEFT JOIN "files" f ON f."ownerId" = u2."id"
      GROUP BY u2."id"
    ) a
    WHERE a."id" = u."id" AND u."storageUsedBytes" <> a.actual
      AND u."updatedAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 hour'`;
}
