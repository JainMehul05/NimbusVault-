import type { Prisma } from '@prisma/client';

/**
 * Serializes work on `key` until the surrounding transaction ends (PostgreSQL advisory lock).
 * Used where a uniqueness or tree rule spans rows and so cannot be a plain constraint.
 */
export async function lockInTransaction(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export const fileNamesLock = (ownerId: string, folderId: string | null) => `file-names:${ownerId}:${folderId ?? 'root'}`;
export const folderTreeLock = (ownerId: string) => `folder-tree:${ownerId}`;
