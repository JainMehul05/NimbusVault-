import type { PrismaClient, Folder, Prisma } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { logger } from '@common/logger';

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

  async rename(folderId: string, userId: string, newName: string): Promise<Folder> {
    const folder = await this.validateFolderOwnership(folderId, userId);

    await this.checkDuplicateName(userId, folder.parentFolderId, newName, folderId);

    return this.prismaClient.folder.update({
      where: { id: folderId },
      data: { name: newName },
    });
  }

  async move(folderId: string, userId: string, newParentFolderId: string | null): Promise<Folder> {
    const folder = await this.validateFolderOwnership(folderId, userId);

    await this.checkCircularReference(folderId, newParentFolderId);

    let newDepth = 0;
    if (newParentFolderId) {
      const newParent = await this.validateFolderOwnership(newParentFolderId, userId);
      newDepth = newParent.depth + 1;
    }

    await this.checkDuplicateName(userId, newParentFolderId, folder.name);

    // Calculate depth difference for descendants
    const depthDiff = newDepth - folder.depth;

    // Update folder and all descendants in a transaction
    return this.prismaClient.$transaction(async (tx) => {
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

  async softDelete(folderId: string, userId: string, options?: { deleteDescendants?: boolean }): Promise<Folder> {
    await this.validateFolderOwnership(folderId, userId);
    const { deleteDescendants = false } = options || {};

    if (deleteDescendants) {
      // Soft delete all descendants (folders and files)
      return this.prismaClient.$transaction(async (tx) => {
        // Soft delete all files in this folder and descendants
        const descendantFolderIds = await this.getAllDescendantIds(tx, folderId);
        const allFolderIds = [folderId, ...descendantFolderIds];

        await tx.file.updateMany({
          where: {
            folderId: { in: allFolderIds },
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        });

        // Soft delete all descendant folders
        await tx.folder.updateMany({
          where: { id: { in: descendantFolderIds } },
          data: { deletedAt: new Date() },
        });

        // Soft delete the folder itself
        return tx.folder.update({
          where: { id: folderId },
          data: { deletedAt: new Date() },
        });
      });
    } else {
      // Check if folder has children or files
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

      return this.prismaClient.folder.update({
        where: { id: folderId },
        data: { deletedAt: new Date() },
      });
    }
  }

  private async getAllDescendantIds(tx: TransactionClient, folderId: string): Promise<string[]> {
    const children = await tx.folder.findMany({
      where: { parentFolderId: folderId },
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

  async getFolderContents(folderId: string, userId: string): Promise<{ folders: Folder[]; files: any[] }> {
    // For root folder (empty string), skip ownership validation
    if (folderId) {
      await this.validateFolderOwnership(folderId, userId);
    }

    const [folders, files] = await Promise.all([
      this.prismaClient.folder.findMany({
        where: { parentFolderId: folderId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prismaClient.file.findMany({
        where: { folderId, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          filename: true,
          sizeBytes: true,
          mimeType: true,
          category: true,
          status: true,
          uploadedAt: true,
        },
      }),
    ]);

    return { folders, files };
  }
}

export const folderService = new FolderService();