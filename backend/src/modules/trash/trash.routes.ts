import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ActivityAction } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { validate } from '@common/validation';
import { config } from '@config/index';
import { intelligenceEnabled } from '@common/intelligence';
import { AppError } from '@common/errors';
import { authenticate } from '@modules/auth/auth.middleware';
import type { AccessTokenPayload } from '@modules/auth/jwt.utils';
import { activityLogService } from '@modules/activity/activity.service';
import { aiIndexingService } from '@modules/ai/indexing.service';
import { trashService } from './trash.service';

type AuthenticatedRequest = Request & { user?: AccessTokenPayload };

const listSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().max(100000).default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});
const idSchema = z.object({ params: z.object({ id: z.string().uuid('Invalid ID') }) });

const record = (
  req: AuthenticatedRequest,
  action: ActivityAction,
  resourceType: 'FILE' | 'FOLDER',
  resourceId: string,
  metadata: Record<string, string | number>
) =>
  activityLogService.logActivity(req.user!.userId, action, {
    resourceType,
    resourceId,
    targetOwnerId: req.user!.userId,
    ipAddress: req.ip,
    metadata,
    requestId: req.requestId,
  });

const router = Router();

// Trash is private to its owner; every operation is scoped to the caller.
router.use(authenticate);
router.use((req,_res,next)=>{
  if(req.method==='DELETE' && intelligenceEnabled()) return next(AppError.conflict('Permanent cloud deletion is disabled; restore items from trash instead.'));
  next();
});

router.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total, totalPages } = await trashService.list(req.user!.userId, page, limit);
    res.json(
      successResponse(
        { items, retentionDays: config.storage.trashRetentionDays, permanentDeletionEnabled: !intelligenceEnabled(), pagination: { page, limit, total, totalPages } },
        'Trash retrieved',
        req.requestId
      )
    );
  })
);

router.post(
  '/files/:id/restore',
  validate(idSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const file = await trashService.restoreFile(req.params.id, req.user!.userId);
    await aiIndexingService.onFileUploaded(file).catch(() => undefined);
    await record(req, 'file_restore', 'FILE', file.id, { filename: file.filename });
    res.json(successResponse({ id: file.id, filename: file.filename, folderId: file.folderId }, 'File restored', req.requestId));
  })
);

router.post(
  '/folders/:id/restore',
  validate(idSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { folder, files } = await trashService.restoreFolder(req.params.id, req.user!.userId);
    for (const file of files) await aiIndexingService.onFileUploaded(file).catch(() => undefined);
    await record(req, 'folder_restore', 'FOLDER', folder.id, { name: folder.name, restoredFiles: files.length });
    res.json(
      successResponse(
        { id: folder.id, name: folder.name, parentFolderId: folder.parentFolderId, restoredFiles: files.length },
        'Folder restored',
        req.requestId
      )
    );
  })
);

router.delete(
  '/files/:id',
  validate(idSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const file = await trashService.purgeFileById(req.params.id, req.user!.userId);
    await record(req, 'file_purge', 'FILE', file.id, { filename: file.filename });
    res.json(successResponse(null, 'File permanently deleted', req.requestId));
  })
);

router.delete(
  '/folders/:id',
  validate(idSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { folder, purgedFiles } = await trashService.purgeFolderById(req.params.id, req.user!.userId);
    await record(req, 'folder_purge', 'FOLDER', folder.id, { name: folder.name, purgedFiles });
    res.json(successResponse({ purgedFiles }, 'Folder permanently deleted', req.requestId));
  })
);

router.delete(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const result = await trashService.empty(req.user!.userId);
    if (result.files || result.folders) {
      await activityLogService.logActivity(req.user!.userId, 'file_purge', {
        resourceType: 'USER',
        resourceId: req.user!.userId,
        targetOwnerId: req.user!.userId,
        ipAddress: req.ip,
        metadata: { emptiedTrash: true, ...result },
        requestId: req.requestId,
      });
    }
    res.json(successResponse(result, 'Trash emptied', req.requestId));
  })
);

export default router;
