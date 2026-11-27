import type { File, Folder, Prisma, PrismaClient } from '@prisma/client';
import prisma from '@database/prisma';
import { AppError, ErrorCodes } from '@common/errors';
import { createChildLogger } from '@common/logger';
import { fileNamesLock, folderTreeLock, lockInTransaction } from '@common/locks';
import { firstFreeName } from '@common/names';
import { storageService } from '@common/storage';
import { reserveQuota } from '@modules/files/quota.service';

const log = createChildLogger({ module: 'trash' });

type Tx = Prisma.TransactionClient;

/**
 * Trash: deleted items keep their data for a retention period, then are purged for good.
 * Items deleted together share one `deletedAt`, which identifies the batch to restore.
 * Trashed files do not count towards quota; restoring re-reserves it and can therefore fail.
 */
export class TrashService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /** Top-level trashed items: folders deleted as such, and files deleted on their own. */
  async list(ownerId: string, page: number, limit: number) {
    const folders = await this.prismaClient.$queryRaw<Array<{ id: string; name: string; deletedAt: Date; itemCount: bigint; sizeBytes: bigint }>>`
      WITH RECURSIVE roots AS (
        SELECT d."id", d."name", d."deletedAt" FROM "folders" d
        LEFT JOIN "folders" p ON p."id" = d."parentFolderId"
        WHERE d."ownerId" = ${ownerId} AND d."deletedAt" IS NOT NULL
          AND (p."id" IS NULL OR p."deletedAt" IS DISTINCT FROM d."deletedAt")
      ),
      sub(root, id, "deletedAt") AS (
        SELECT "id", "id", "deletedAt" FROM roots
        UNION
        SELECT sub.root, c."id", sub."deletedAt" FROM "folders" c
        JOIN sub ON c."parentFolderId" = sub.id AND c."deletedAt" = sub."deletedAt"
      )
      SELECT r."id", r."name", r."deletedAt",
             COUNT(f."id")::bigint AS "itemCount", COALESCE(SUM(f."sizeBytes"), 0)::bigint AS "sizeBytes"
      FROM roots r
      JOIN sub s ON s.root = r."id"
      LEFT JOIN "files" f ON f."folderId" = s.id AND f."deletedAt" = r."deletedAt"
      GROUP BY r."id", r."name", r."deletedAt"
      ORDER BY r."deletedAt" DESC, r."id"`;

    const files = await this.prismaClient.$queryRaw<
      Array<{ id: string; filename: string; sizeBytes: bigint; mimeType: string; category: string; deletedAt: Date }>
    >`
      SELECT f."id", f."filename", f."sizeBytes", f."mimeType", f."category"::text AS "category", f."deletedAt"
      FROM "files" f LEFT JOIN "folders" d ON d."id" = f."folderId"
      WHERE f."ownerId" = ${ownerId} AND f."deletedAt" IS NOT NULL
        AND (d."id" IS NULL OR d."deletedAt" IS DISTINCT FROM f."deletedAt")
      ORDER BY f."deletedAt" DESC, f."id"`;

    const items = [
      ...folders.map((f) => ({
        type: 'FOLDER' as const,
        id: f.id,
        name: f.name,
        sizeBytes: f.sizeBytes.toString(),
        itemCount: Number(f.itemCount),
        deletedAt: f.deletedAt,
      })),
      ...files.map((f) => ({
        type: 'FILE' as const,
        id: f.id,
        name: f.filename,
        sizeBytes: f.sizeBytes.toString(),
        mimeType: f.mimeType,
        category: f.category,
        deletedAt: f.deletedAt,
      })),
    ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

    return {
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      totalPages: Math.ceil(items.length / limit),
    };
  }

  private async trashedFile(db: PrismaClient | Tx, fileId: string, ownerId: string): Promise<File> {
    const file = await db.file.findFirst({ where: { id: fileId, ownerId, deletedAt: { not: null } } });
    if (!file) throw AppError.notFound('Item not found in trash', ErrorCodes.FILE_NOT_FOUND);
    return file;
  }

  private async trashedFolder(db: PrismaClient | Tx, folderId: string, ownerId: string): Promise<Folder> {
    const folder = await db.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: { not: null } } });
    if (!folder) throw AppError.notFound('Item not found in trash', ErrorCodes.FOLDER_NOT_FOUND);
    return folder;
  }

  /** Restores to the original folder, or to the top level when that folder is gone. */
  async restoreFile(fileId: string, ownerId: string): Promise<File> {
    return this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(ownerId));
      const file = await this.trashedFile(tx, fileId, ownerId);
      const parent = file.folderId
        ? await tx.folder.findFirst({ where: { id: file.folderId, ownerId, deletedAt: null }, select: { id: true } })
        : null;
      const folderId = parent?.id ?? null;

      await lockInTransaction(tx, fileNamesLock(ownerId, folderId));
      const taken = await tx.file.findMany({ where: { ownerId, folderId, deletedAt: null }, select: { filename: true } });
      await reserveQuota(tx, ownerId, file.sizeBytes);

      const { count } = await tx.file.updateMany({
        // Not READY means a purge has already claimed it.
        where: { id: fileId, deletedAt: { not: null }, status: 'READY' },
        data: { deletedAt: null, folderId, filename: firstFreeName(file.filename, new Set(taken.map((f) => f.filename))) },
      });
      if (count === 0) throw AppError.notFound('Item not found in trash', ErrorCodes.FILE_NOT_FOUND);
      return tx.file.findUniqueOrThrow({ where: { id: fileId } });
    });
  }

  /** Folder plus everything deleted together with it. */
  private async batch(db: PrismaClient | Tx, folder: Folder): Promise<{ folderIds: string[]; files: File[] }> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub(id) AS (
        SELECT ${folder.id}::text
        UNION
        SELECT c."id" FROM "folders" c JOIN sub ON c."parentFolderId" = sub.id
        WHERE c."deletedAt" = ${folder.deletedAt!.toISOString()}::timestamp
      )
      SELECT id FROM sub`;
    const folderIds = rows.map((r) => r.id);
    const files = await db.file.findMany({
      where: { folderId: { in: folderIds }, deletedAt: folder.deletedAt, status: 'READY' },
    });
    return { folderIds, files };
  }

  async restoreFolder(folderId: string, ownerId: string): Promise<{ folder: Folder; files: File[] }> {
    return this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(ownerId));
      const folder = await this.trashedFolder(tx, folderId, ownerId);
      const { folderIds, files } = await this.batch(tx, folder);

      const parent = folder.parentFolderId
        ? await tx.folder.findFirst({ where: { id: folder.parentFolderId, ownerId, deletedAt: null } })
        : null;
      const parentFolderId = parent?.id ?? null;
      const depth = parent ? parent.depth + 1 : 0;

      const siblings = await tx.folder.findMany({ where: { ownerId, parentFolderId, deletedAt: null }, select: { name: true } });
      const name = firstFreeName(folder.name, new Set(siblings.map((s) => s.name)));

      const total = files.reduce((sum, f) => sum + f.sizeBytes, 0n);
      if (total > 0n) await reserveQuota(tx, ownerId, total);

      const descendants = folderIds.filter((id) => id !== folderId);
      await tx.folder.update({ where: { id: folderId }, data: { deletedAt: null, parentFolderId, depth, name } });
      if (descendants.length) {
        await tx.folder.updateMany({
          where: { id: { in: descendants } },
          data: { deletedAt: null, depth: { increment: depth - folder.depth } },
        });
      }
      const restored = await tx.file.updateMany({
        where: { id: { in: files.map((f) => f.id) }, status: 'READY' },
        data: { deletedAt: null },
      });
      if (restored.count !== files.length) {
        throw AppError.conflict('Some files are being permanently deleted. Try again shortly.', 'FOLDER_BUSY');
      }

      return { folder: await tx.folder.findUniqueOrThrow({ where: { id: folderId } }), files };
    });
  }

  /**
   * Permanently removes a trashed file: claim it (so it can no longer be restored), delete the
   * object, then the rows (share links, AI data and permissions with it). If storage refuses,
   * the row stays in trash and the purge is retried, so an object is never orphaned.
   */
  private async purgeFile(file: Pick<File, 'id' | 's3Key'>): Promise<void> {
    const { count } = await this.prismaClient.file.updateMany({
      where: { id: file.id, deletedAt: { not: null } },
      data: { status: 'FAILED' },
    });
    if (count === 0) return; // restored or purged meanwhile
    await storageService.delete(file.s3Key);
    await this.prismaClient.$transaction([
      this.prismaClient.permission.deleteMany({ where: { resourceType: 'FILE', resourceId: file.id } }),
      this.prismaClient.file.deleteMany({ where: { id: file.id, deletedAt: { not: null } } }),
    ]);
  }

  async purgeFileById(fileId: string, ownerId: string): Promise<File> {
    const file = await this.trashedFile(this.prismaClient, fileId, ownerId);
    await this.purgeFile(file);
    return file;
  }

  async purgeFolderById(folderId: string, ownerId: string): Promise<{ folder: Folder; purgedFiles: number }> {
    const folder = await this.trashedFolder(this.prismaClient, folderId, ownerId);
    return { folder, purgedFiles: await this.purgeFolder(folder) };
  }

  private async purgeFolder(folder: Folder): Promise<number> {
    const rows = await this.prismaClient.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub(id) AS (
        SELECT ${folder.id}::text
        UNION
        SELECT c."id" FROM "folders" c JOIN sub ON c."parentFolderId" = sub.id
      )
      SELECT id FROM sub`;
    const folderIds = rows.map((r) => r.id);

    // Everything below a trashed folder is itself trashed (deletion is recursive), whatever its batch.
    const files = await this.prismaClient.file.findMany({
      where: { folderId: { in: folderIds }, deletedAt: { not: null } },
      select: { id: true, s3Key: true },
    });
    for (const file of files) await this.purgeFile(file);

    await this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(folder.ownerId));
      // Never cascade over something live: e.g. an upload reservation awaiting the sweeper.
      const live =
        (await tx.file.count({ where: { folderId: { in: folderIds } } })) +
        (await tx.folder.count({ where: { id: { in: folderIds }, deletedAt: null } }));
      if (live > 0) {
        throw AppError.conflict('This folder still has items being processed. Try again shortly.', 'FOLDER_BUSY');
      }
      await tx.permission.deleteMany({ where: { resourceType: 'FOLDER', resourceId: { in: folderIds } } });
      await tx.folder.deleteMany({ where: { id: folder.id } });
    });
    return files.length;
  }

  async empty(ownerId: string): Promise<{ files: number; folders: number }> {
    let files = 0;
    let folders = 0;
    const roots = await this.prismaClient.folder.findMany({
      where: { ownerId, deletedAt: { not: null }, OR: [{ parentFolderId: null }, { parent: { deletedAt: null } }] },
    });
    for (const folder of roots) {
      files += await this.purgeFolder(folder);
      folders++;
    }
    const loose = await this.prismaClient.file.findMany({
      where: { ownerId, deletedAt: { not: null } },
      select: { id: true, s3Key: true },
    });
    for (const file of loose) {
      await this.purgeFile(file);
      files++;
    }
    return { files, folders };
  }

  /** Background retention: purges items trashed before the cutoff. Failures are retried next run. */
  async purgeExpired(retentionDays: number, limit = 200): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    let purged = 0;

    const files = await this.prismaClient.file.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, s3Key: true },
      orderBy: { deletedAt: 'asc' },
      take: limit,
    });
    for (const file of files) {
      try {
        await this.purgeFile(file);
        purged++;
      } catch (err) {
        log.warn({ err: (err as Error).message, fileId: file.id }, 'Could not purge trashed file; will retry');
      }
    }

    const folders = await this.prismaClient.folder.findMany({
      where: { deletedAt: { lt: cutoff }, OR: [{ parentFolderId: null }, { parent: { deletedAt: null } }] },
      take: limit,
    });
    for (const folder of folders) {
      try {
        purged += await this.purgeFolder(folder);
      } catch (err) {
        log.warn({ err: (err as Error).message, folderId: folder.id }, 'Could not purge trashed folder; will retry');
      }
    }
    if (purged) log.info({ purged }, 'Purged expired trash');
    return purged;
  }
}

export const trashService = new TrashService();
