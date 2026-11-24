import type { PrismaClient, Folder, Prisma } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { logger } from '@common/logger';
import { authorizationService, type PermissionLevel } from '@common/authorization';

type TransactionClient = Prisma.TransactionClient;

export interface CreateFolderInput {
  name: string;
  ownerId: string;
  parentFolderId: string | null;
  depth: number;
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

export interface SafeFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  childrenCount: number;
  filesCount: number;
}

export class FolderService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  private toSafeFolder(folder: Folder & { _count?: { children: number; files: number } }): SafeFolder {
    return {
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
      depth: folder.depth,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      deletedAt: folder.deletedAt,
      childrenCount: folder._count?.children || 0,
      filesCount: folder._count?.files || 0,
    };
  }

  async calculateDepth(parentFolderId: string | null): Promise<number> {
    if (!parentFolderId) return 0;

    const parent = await this.prismaClient.folder.findUnique({
      where: { id: parentFolderId },
      select: { depth: true },
    });

    if (!parent) {
      throw AppError.notFound('Parent folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    return parent.depth + 1;
  }

  async validateFolderOwnership(folderId: string, userId: string): Promise<Folder> {
    const folder = await this.prismaClient.folder.findFirst({
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

  async checkCircularReference(folderId: string, newParentId: string | null): Promise<void> {
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
      const parentFolder: { parentFolderId: string | null } | null = await this.prismaClient.folder.findUnique({
        where: { id: currentId },
        select: { parentFolderId: true },
      });
      currentId = parentFolder?.parentFolderId ?? null;
    }
  }

  async checkDuplicateName(ownerId: string, parentFolderId: string | null, name: string, excludeId?: string): Promise<void> {
    const where: any = {
      ownerId,
      parentFolderId,
      name,
      deletedAt: null,
    };

    if (excludeId) {
      where.NOT = { id: excludeId };
    }

    const existing = await this.prismaClient.folder.findFirst({ where });

    if (existing) {
      throw AppError.conflict('A folder with this name already exists in this location', ErrorCodes.NAME_CONFLICT);
    }
  }

  async create(input: CreateFolderInput): Promise<Folder> {
    return this.prismaClient.folder.create({
      data: {
        name: input.name,
        ownerId: input.ownerId,
        parentFolderId: input.parentFolderId,
        depth: input.depth,
      },
    });
  }

  async findById(folderId: string, userId: string): Promise<Folder | null> {
    return this.prismaClient.folder.findFirst({
      where: {
        id: folderId,
        ownerId: userId,
        deletedAt: null,
      },
    });
  }

  async findByIdAnyStatus(folderId: string, userId: string): Promise<Folder | null> {
    return this.prismaClient.folder.findFirst({
      where: {
        id: folderId,
        ownerId: userId,
      },
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

    const where: any = {
      ownerId: userId,
      deletedAt: null,
    };

    if (parentFolderId !== undefined) {
      where.parentFolderId = parentFolderId;
    }

    const validSortFields = ['name', 'createdAt', 'depth'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';

    const [folders, total] = await Promise.all([
      this.prismaClient.folder.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              children: true,
              files: true,
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

  async getFolderTree(userId: string, rootFolderId: string | null = null): Promise<any> {
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
    const buildTree = (parentId: string | null): any[] => {
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
    const folder = await this.validateFolderOwnership(folderId, userId);

    await this.checkDuplicateName(userId, folder.parentFolderId, newName, folderId);

    const updated = await this.prismaClient.folder.update({
      where: { id: folderId },
      data: { name: newName },
    });
    return { folder: updated, oldName: folder.name };
  }

  async move(folderId: string, userId: string, newParentFolderId: string | null): Promise<{ folder: Folder; previousParentId: string | null }> {
    const folder = await this.validateFolderOwnership(folderId, userId);

    await this.checkCircularReference(folderId, newParentFolderId);

    let newDepth = 0;
    if (newParentFolderId) {
      const newParent = await this.validateFolderOwnership(newParentFolderId, userId);
      newDepth = newParent.depth + 1;
    }

    await this.checkDuplicateName(userId, newParentFolderId, folder.name, folderId);

    // Calculate depth difference for descendants
    const depthDiff = newDepth - folder.depth;

    // Update folder and all descendants in a transaction
    const moved = await this.prismaClient.$transaction(async (tx) => {
      // Update the folder itself
      const updatedFolder = await tx.folder.update({
        where: { id: folderId },
        data: {
          parentFolderId: newParentFolderId,
          depth: newDepth,
        },
      });

      // Update all descendants' depth
      if (depthDiff !== 0) {
        await this.updateDescendantsDepth(tx, folderId, depthDiff);
      }

      return updatedFolder;
    });
    return { folder: moved, previousParentId: folder.parentFolderId };
  }

  private async updateDescendantsDepth(tx: TransactionClient, folderId: string, depthDiff: number): Promise<void> {
    const children = await tx.folder.findMany({
      where: { parentFolderId: folderId },
      select: { id: true },
    });

    for (const child of children) {
      await tx.folder.update({
        where: { id: child.id },
        data: { depth: { increment: depthDiff } },
      });
      await this.updateDescendantsDepth(tx, child.id, depthDiff);
    }
  }

  /**
   * Soft-deletes a folder (owner only). With `deleteDescendants`, every subfolder and file is
   * deleted in the same transaction and their storage is returned to the owner's quota.
   * Returns the deleted folder plus the ids of files that were deleted.
   */
  async softDelete(
    folderId: string,
    userId: string,
    options?: { deleteDescendants?: boolean }
  ): Promise<{ folder: Folder; deletedFileIds: string[] }> {
    await this.validateFolderOwnership(folderId, userId);
    const { deleteDescendants = false } = options || {};
    const now = new Date();

    if (deleteDescendants) {
      return this.prismaClient.$transaction(async (tx) => {
        const descendantFolderIds = await this.getAllDescendantIds(tx, folderId);
        const allFolderIds = [folderId, ...descendantFolderIds];

        const files = await tx.file.findMany({
          where: { folderId: { in: allFolderIds }, deletedAt: null },
          select: { id: true, sizeBytes: true },
        });
        const freed = files.reduce((sum, f) => sum + f.sizeBytes, 0n);

        if (files.length) {
          await tx.file.updateMany({
            where: { id: { in: files.map((f) => f.id) }, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.user.update({ where: { id: userId }, data: { storageUsedBytes: { decrement: freed } } });
        }

        if (descendantFolderIds.length) {
          await tx.folder.updateMany({ where: { id: { in: descendantFolderIds }, deletedAt: null }, data: { deletedAt: now } });
        }

        const folder = await tx.folder.update({ where: { id: folderId }, data: { deletedAt: now } });
        return { folder, deletedFileIds: files.map((f) => f.id) };
      });
    }

    const childrenCount = await this.prismaClient.folder.count({
      where: { parentFolderId: folderId, deletedAt: null },
    });

    const filesCount = await this.prismaClient.file.count({
      where: { folderId, deletedAt: null },
    });

    if (childrenCount > 0 || filesCount > 0) {
      throw AppError.conflict(
        'Folder is not empty. Use deleteDescendants option to delete with all contents.',
        ErrorCodes.NAME_CONFLICT,
        { childrenCount, filesCount }
      );
    }

    const folder = await this.prismaClient.folder.update({
      where: { id: folderId },
      data: { deletedAt: now },
    });
    return { folder, deletedFileIds: [] };
  }

  private async getAllDescendantIds(tx: TransactionClient, folderId: string): Promise<string[]> {
    const children = await tx.folder.findMany({
      where: { parentFolderId: folderId, deletedAt: null },
      select: { id: true },
    });

    let allIds: string[] = [];
    for (const child of children) {
      allIds.push(child.id);
      const descendantIds = await this.getAllDescendantIds(tx, child.id);
      allIds = [...allIds, ...descendantIds];
    }

    return allIds;
  }

  async permanentDelete(folderId: string, userId: string): Promise<void> {
    const folder = await this.findByIdAnyStatus(folderId, userId);
    if (!folder) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    // Delete all files in this folder and descendants from storage and DB
    const descendantFolderIds = await this.getAllDescendantIds(this.prismaClient, folderId);
    const allFolderIds = [folderId, ...descendantFolderIds];

    const files = await this.prismaClient.file.findMany({
      where: { folderId: { in: allFolderIds } },
      select: { s3Key: true, id: true },
    });

    // Delete from storage
    for (const file of files) {
      try {
        await import('@common/storage').then(({ storageService }) => storageService.delete(file.s3Key));
      } catch (error) {
        logger.error({ err: error, s3Key: file.s3Key }, 'Failed to delete file from storage during folder deletion');
      }
    }

    // Delete from database (cascade will handle files and descendant folders)
    await this.prismaClient.folder.delete({
      where: { id: folderId },
    });
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
          ? { folderId: folder.id, deletedAt: null }
          : { ownerId: userId, folderId: null, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
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