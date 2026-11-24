import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { folderService } from './folders.service';
import { createRequestLogger } from '@common/logger';
import type { FolderCreateInput, FolderListQuery } from './folders.validation';
import { activityLogService } from '@modules/activity/activity.service';
import { aiIndexingService } from '@modules/ai/indexing.service';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

export const foldersController = {
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { name, parentFolderId } = req.body as FolderCreateInput;

    // Validate parent folder if provided
    let depth = 0;
    if (parentFolderId) {
      const parentFolder = await folderService.validateFolderOwnership(parentFolderId, userId);
      depth = parentFolder.depth + 1;
    }

    // Check for duplicate name
    await folderService.checkDuplicateName(userId, parentFolderId || null, name);

    const folder = await folderService.create({
      name,
      ownerId: userId,
      parentFolderId: parentFolderId || null,
      depth,
    });

    await activityLogService.logActivity(userId, 'folder_create', {
      resourceType: 'FOLDER',
      resourceId: folder.id,
      targetOwnerId: userId,
      ipAddress: req.ip,
      metadata: { name: folder.name, parentFolderId: folder.parentFolderId },
      requestId,
    });

    log.info({ folderId: folder.id }, 'Folder created successfully');

    res.status(201).json(
      successResponse(
        {
          id: folder.id,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
          depth: folder.depth,
          createdAt: folder.createdAt,
        },
        'Folder created successfully',
        requestId
      )
    );
  }),

  list: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const query = req.query as unknown as FolderListQuery;

    const result = await folderService.listFolders(userId, {
      parentFolderId: query.parentFolderId !== undefined ? query.parentFolderId : undefined,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const safeFolders = result.folders.map((folder) => ({
      ...folder,
      childrenCount: folder._count?.children || 0,
      filesCount: folder._count?.files || 0,
    }));

    res.json(
      successResponse(
        {
          folders: safeFolders,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
        'Folders retrieved successfully',
        req.requestId
      )
    );
  }),

  getTree: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { folderId } = req.params;

    let rootFolderId: string | null = null;
    if (folderId && folderId !== 'root') {
      const folder = await folderService.validateFolderOwnership(folderId, userId);
      rootFolderId = folder.id;
    }

    const tree = await folderService.getFolderTree(userId, rootFolderId);

    res.json(
      successResponse(
        { tree },
        'Folder tree retrieved successfully',
        req.requestId
      )
    );
  }),

  getContents: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { folderId } = req.params;

    const contents = await folderService.getFolderContents(folderId && folderId !== 'root' ? folderId : null, userId);

    res.json(
      successResponse(
        {
          folder: contents.folder
            ? { id: contents.folder.id, name: contents.folder.name, parentFolderId: contents.folder.parentFolderId, ownerId: contents.folder.ownerId }
            : null,
          permission: contents.permission,
          path: contents.path,
          folders: contents.folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            parentFolderId: folder.parentFolderId,
            depth: folder.depth,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
          })),
          files: contents.files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })),
        },
        'Folder contents retrieved successfully',
        req.requestId
      )
    );
  }),

  rename: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { folderId } = req.params;
    const { name } = req.body;

    const { folder, oldName } = await folderService.rename(folderId, userId, name);

    if (oldName !== folder.name) {
      await activityLogService.logActivity(userId, 'folder_rename', {
        resourceType: 'FOLDER',
        resourceId: folder.id,
        targetOwnerId: folder.ownerId,
        ipAddress: req.ip,
        metadata: { oldName, newName: folder.name, name: folder.name },
        requestId: req.requestId,
      });
    }

    res.json(
      successResponse(
        {
          id: folder.id,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
          depth: folder.depth,
          updatedAt: folder.updatedAt,
        },
        'Folder renamed successfully',
        req.requestId
      )
    );
  }),

  move: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { folderId } = req.params;
    const { parentFolderId } = req.body;

    const { folder, previousParentId } = await folderService.move(folderId, userId, parentFolderId || null);

    if (previousParentId !== folder.parentFolderId) {
      await activityLogService.logActivity(userId, 'folder_move', {
        resourceType: 'FOLDER',
        resourceId: folder.id,
        targetOwnerId: folder.ownerId,
        ipAddress: req.ip,
        metadata: { name: folder.name, previousParentId, newParentId: folder.parentFolderId },
        requestId: req.requestId,
      });
    }

    res.json(
      successResponse(
        {
          id: folder.id,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
          depth: folder.depth,
          updatedAt: folder.updatedAt,
        },
        'Folder moved successfully',
        req.requestId
      )
    );
  }),

  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { folderId } = req.params;
    const deleteDescendantsRaw = req.query.deleteDescendants;
    const deleteDescendants = Array.isArray(deleteDescendantsRaw)
      ? deleteDescendantsRaw[0] === 'true'
      : deleteDescendantsRaw === 'true';

    const { folder, deletedFileIds } = await folderService.softDelete(folderId, userId, { deleteDescendants });

    await aiIndexingService.purgeFiles(deletedFileIds);

    await activityLogService.logActivity(userId, 'folder_delete', {
      resourceType: 'FOLDER',
      resourceId: folder.id,
      targetOwnerId: folder.ownerId,
      ipAddress: req.ip,
      metadata: { name: folder.name, deletedFiles: deletedFileIds.length },
      requestId: req.requestId,
    });

    res.json(
      successResponse(
        {
          id: folder.id,
          name: folder.name,
          deletedAt: folder.deletedAt,
          deletedFiles: deletedFileIds.length,
        },
        'Folder deleted successfully',
        req.requestId
      )
    );
  }),
};
