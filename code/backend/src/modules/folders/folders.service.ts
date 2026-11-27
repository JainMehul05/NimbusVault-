import type { PrismaClient, Folder, Prisma } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { authorizationService, MAX_FOLDER_DEPTH, type PermissionLevel } from '@common/authorization';
import { folderTreeLock, lockInTransaction } from '@common/locks';
import { releaseQuota } from '@modules/files/quota.service';

type TransactionClient = Prisma.TransactionClient;

/** Deeper than this and permission inheritance could no longer be resolved. */
const assertDepth = (depth: number) => {
  if (depth >= MAX_FOLDER_DEPTH) {
    throw AppError.badRequest(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`, 'FOLDER_TOO_DEEP');
  }
};

export interface CreateFolderInput {
  name: string;
  ownerId: string;
  parentFolderId: string | null;
}

export interface FolderListResult {
  folders: Array<{
    id: string;
    name: string;
    ownerId: string;
    parentFolderId: string | null;
    depth: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    _count: {
      children: number;
      files: number;
    };
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  children: FolderTreeNode[];
}

export class FolderService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async validateFolderOwnership(
    folderId: string,
    userId: string,
    db: PrismaClient | TransactionClient = this.prismaClient
  ): Promise<Folder> {
    const folder = await db.folder.findFirst({
      where: {
        id: folderId,
        ownerId: userId,
        deletedAt: null,
      },
    });

    if (!folder) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    return folder;
  }

  private async checkCircularReference(tx: TransactionClient, folderId: string, newParentId: string | null): Promise<void> {
    if (!newParentId) return;
    if (folderId === newParentId) {
      throw AppError.badRequest('Cannot move folder into itself', ErrorCodes.FOLDER_CYCLE);
    }

    // Check if newParentId is a descendant of folderId
    let currentId: string | null = newParentId;
    while (currentId) {
      if (currentId === folderId) {
        throw AppError.badRequest('Cannot move folder into its own descendant', ErrorCodes.FOLDER_CYCLE);
      }
      const parentFolder: { parentFolderId: string | null } | null = await tx.folder.findUnique({
        where: { id: currentId },
        select: { parentFolderId: true },
      });
      currentId = parentFolder?.parentFolderId ?? null;
    }
  }

  private async checkDuplicateName(
    tx: TransactionClient,
    ownerId: string,
    parentFolderId: string | null,
    name: string,
    excludeId?: string
  ): Promise<void> {
    const existing = await tx.folder.findFirst({
      where: { ownerId, parentFolderId, name, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });

    if (existing) {
      throw AppError.conflict('A folder with this name already exists in this location', ErrorCodes.NAME_CONFLICT);
    }
  }

  async create(input: CreateFolderInput): Promise<Folder> {
    return this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(input.ownerId));
      const depth = input.parentFolderId
        ? (await this.validateFolderOwnership(input.parentFolderId, input.ownerId, tx)).depth + 1
        : 0;
      assertDepth(depth);
      await this.checkDuplicateName(tx, input.ownerId, input.parentFolderId, input.name);
      return tx.folder.create({ data: { ...input, depth } });
    });
  }

  async listFolders(
    userId: string,
    options: {
      parentFolderId?: string | null;
      page: number;
      limit: number;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    }
  ): Promise<FolderListResult> {
    const { parentFolderId, page, limit, sortBy, sortOrder } = options;

    const where: Prisma.FolderWhereInput = {
      ownerId: userId,
      deletedAt: null,
      ...(parentFolderId !== undefined ? { parentFolderId } : {}),
    };

    const validSortFields = ['name', 'createdAt', 'depth'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';

    const [folders, total] = await Promise.all([
      this.prismaClient.folder.findMany({
        where,
        orderBy: [{ [sortField]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              children: { where: { deletedAt: null } },
              files: { where: { deletedAt: null, status: 'READY' } },
            },
          },
        },
      }),
      this.prismaClient.folder.count({ where }),
    ]);

    return {
      folders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFolderTree(userId: string, rootFolderId: string | null = null): Promise<FolderTreeNode[]> {
    // Fetch all folders for this user in a single query
    const allFolders = await this.prismaClient.folder.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        parentFolderId: true,
        depth: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Build adjacency list for tree construction
    const childrenMap = new Map<string | null, typeof allFolders>();
    for (const folder of allFolders) {
      const parentKey = folder.parentFolderId ?? null;
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, []);
      }
      childrenMap.get(parentKey)!.push(folder);
    }

    // Recursive function to build tree
    const buildTree = (parentId: string | null): FolderTreeNode[] => {
      const children = childrenMap.get(parentId) || [];
      return children.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentFolderId,
        depth: folder.depth,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        children: buildTree(folder.id),
      }));
    };

    const rootParentId = rootFolderId ?? null;
    return buildTree(rootParentId);
  }

  async rename(folderId: string, userId: string, newName: string): Promise<{ folder: Folder; oldName: string }> {
    return this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(userId));
      const folder = await this.validateFolderOwnership(folderId, userId, tx);
      await this.checkDuplicateName(tx, userId, folder.parentFolderId, newName, folderId);
      const updated = await tx.folder.update({ where: { id: folderId }, data: { name: newName } });
      return { folder: updated, oldName: folder.name };
    });
  }

  async move(folderId: string, userId: string, newParentFolderId: string | null): Promise<{ folder: Folder; previousParentId: string | null }> {
    return this.prismaClient.$transaction(async (tx) => {
      // All tree checks happen under one per-owner lock: two concurrent moves could otherwise
      // each pass the cycle check and together create a cycle.
      await lockInTransaction(tx, folderTreeLock(userId));
      const folder = await this.validateFolderOwnership(folderId, userId, tx);
      await this.checkCircularReference(tx, folderId, newParentFolderId);

      const newDepth = newParentFolderId
        ? (await this.validateFolderOwnership(newParentFolderId, userId, tx)).depth + 1
        : 0;
      const depthDiff = newDepth - folder.depth;

      const descendants = await this.getDescendantIds(tx, folderId);
      if (descendants.length) {
        const deepest = await tx.folder.aggregate({ where: { id: { in: descendants } }, _max: { depth: true } });
        assertDepth((deepest._max.depth ?? 0) + depthDiff);
      }
      assertDepth(newDepth);
      await this.checkDuplicateName(tx, userId, newParentFolderId, folder.name, folderId);

      const moved = await tx.folder.update({
        where: { id: folderId },
        data: { parentFolderId: newParentFolderId, depth: newDepth },
      });
      if (depthDiff !== 0 && descendants.length) {
        await tx.folder.updateMany({ where: { id: { in: descendants } }, data: { depth: { increment: depthDiff } } });
      }
      return { folder: moved, previousParentId: folder.parentFolderId };
    });
  }

  /**
   * Moves a folder to the trash (owner only). With `deleteDescendants`, every subfolder and file
   * is deleted in the same transaction, with the same timestamp (so they can be restored
   * together), and their storage is returned to the owner's quota.
   * Returns the deleted folder plus the ids of files that were deleted.
   */
  async softDelete(
    folderId: string,
    userId: string,
    options?: { deleteDescendants?: boolean }
  ): Promise<{ folder: Folder; deletedFileIds: string[] }> {
    const { deleteDescendants = false } = options || {};
    const now = new Date();

    return this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, folderTreeLock(userId));
      await this.validateFolderOwnership(folderId, userId, tx);

      const descendantFolderIds = await this.getDescendantIds(tx, folderId);
      const allFolderIds = [folderId, ...descendantFolderIds];

      if (!deleteDescendants) {
        const filesCount = await tx.file.count({ where: { folderId, deletedAt: null } });
        const childrenCount = await tx.folder.count({ where: { parentFolderId: folderId, deletedAt: null } });
        if (childrenCount > 0 || filesCount > 0) {
          throw AppError.conflict(
            'Folder is not empty. Use deleteDescendants option to delete with all contents.',
            ErrorCodes.NAME_CONFLICT,
            { childrenCount, filesCount }
          );
        }
      }

      // Folders first: uploads re-check their folder before recording a file, so none can land
      // in this subtree after this point. In-progress presigned uploads are left for the sweeper.
      await tx.folder.updateMany({ where: { id: { in: allFolderIds }, deletedAt: null }, data: { deletedAt: now } });

      const deletedFiles = await tx.$queryRaw<Array<{ id: string; sizeBytes: bigint }>>`
        UPDATE "files" SET "deletedAt" = ${now.toISOString()}::timestamp
        WHERE "folderId" = ANY(${allFolderIds}) AND "deletedAt" IS NULL AND "status" <> 'UPLOADING'::"FileStatus"
        RETURNING "id", "sizeBytes"`;
      const freed = deletedFiles.reduce((sum, f) => sum + BigInt(f.sizeBytes), 0n);
      if (freed > 0n) await releaseQuota(tx, userId, freed);

      const folder = await tx.folder.findUniqueOrThrow({ where: { id: folderId } });
      return { folder, deletedFileIds: deletedFiles.map((f) => f.id) };
    });
  }

  /** Live descendants of a folder (excluding itself), at any depth, in one query. */
  private async getDescendantIds(tx: TransactionClient, folderId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub(id) AS (
        SELECT "id" FROM "folders" WHERE "parentFolderId" = ${folderId} AND "deletedAt" IS NULL
        UNION
        SELECT f."id" FROM "folders" f JOIN sub ON f."parentFolderId" = sub.id WHERE f."deletedAt" IS NULL
      )
      SELECT id FROM sub`;
    return rows.map((r) => r.id);
  }

  /**
   * Contents of a folder the user can read (own or shared, including inherited access), or of
   * the user's own root when `folderId` is null. Also returns the caller's effective role and
   * the breadcrumb path, truncated at the highest ancestor the caller can access.
   */
  async getFolderContents(
    folderId: string | null,
    userId: string
  ): Promise<{
    folder: Folder | null;
    permission: PermissionLevel;
    path: Array<{ id: string; name: string }>;
    folders: Folder[];
    files: Array<{
      id: string;
      filename: string;
      sizeBytes: bigint;
      mimeType: string;
      category: string;
      folderId: string | null;
      status: string;
      aiStatus: string;
      uploadedAt: Date;
    }>;
  }> {
    let folder: Folder | null = null;
    let permission: PermissionLevel = 'OWNER';
    if (folderId) {
      const access = await authorizationService.authorizeFolderAccess({ userId, isAuthenticated: true }, folderId, 'read');
      folder = access.folder!;
      permission = access.effectiveLevel;
    }

    const fileSelect = {
      id: true,
      filename: true,
      sizeBytes: true,
      mimeType: true,
      category: true,
      folderId: true,
      status: true,
      aiStatus: true,
      uploadedAt: true,
    } as const;

    const [folders, files] = await Promise.all([
      this.prismaClient.folder.findMany({
        where: folder
          ? { parentFolderId: folder.id, deletedAt: null }
          : { ownerId: userId, parentFolderId: null, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prismaClient.file.findMany({
        where: folder
          ? { folderId: folder.id, deletedAt: null, status: 'READY' }
          : { ownerId: userId, folderId: null, deletedAt: null, status: 'READY' },
        orderBy: { uploadedAt: 'desc' },
        take: 1000,
        select: fileSelect,
      }),
    ]);

    const path: Array<{ id: string; name: string }> = [];
    let cursor: Folder | null = folder;
    while (cursor && path.length < 64) {
      path.unshift({ id: cursor.id, name: cursor.name });
      if (!cursor.parentFolderId) break;
      const parentLevel = await authorizationService.getEffectivePermissionLevel(userId, 'FOLDER', cursor.parentFolderId);
      if (!parentLevel) break; // stop at the top of the shared subtree
      cursor = await this.prismaClient.folder.findUnique({ where: { id: cursor.parentFolderId } });
    }

    return { folder, permission, path, folders, files };
  }
}

export const folderService = new FolderService();