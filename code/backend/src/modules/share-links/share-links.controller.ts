import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { shareLinkService } from './share-links.service';
import { createRequestLogger } from '@common/logger';
import { activityLogService } from '@modules/activity/activity.service';
import { presignFileDownload } from '@modules/files/files.controller';

/**
 * Password from the X-Share-Password header (percent-encoded UTF-8, since headers are ASCII).
 * `?password=` is still read for links shared with older clients.
 */
const sharePassword = (req: Request): string | undefined => {
  const header = req.get('x-share-password');
  if (header) {
    if (header.length > 1024) return undefined;
    if (req.get('x-share-password-encoding') !== 'percent') return header;
    try {
      return decodeURIComponent(header);
    } catch {
      return undefined;
    }
  }
  const q = req.query.password;
  return typeof q === 'string' && q && q.length <= 1024 ? q : undefined;
};

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

export const shareLinkController = {
  createShareLink: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { fileId, permission, password, expiresAt, maxDownloads } = req.body;

    const result = await shareLinkService.createShareLink({
      fileId,
      createdBy: userId,
      permission,
      password,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      maxDownloads,
      requestId,
    });

    log.info({ shareLinkId: result.id, fileId, permission }, 'Share link created');

    res.status(201).json(
      successResponse(
        {
          id: result.id,
          permission: result.permission,
          expiresAt: result.expiresAt,
          maxDownloads: result.maxDownloads,
          downloadCount: result.downloadCount,
          createdAt: result.createdAt,
          url: result.url,
          // Only return token on creation
          token: result.token,
        },
        'Share link created successfully',
        requestId
      )
    );
  }),

  listShareLinks: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { fileId } = req.params;

    const shareLinks = await shareLinkService.listShareLinks(fileId, userId, requestId);

    log.info({ fileId, count: shareLinks.length }, 'Share links listed');

    res.json(
      successResponse(
        {
          shareLinks: shareLinks.map(link => ({
            id: link.id,
            permission: link.permission,
            expiresAt: link.expiresAt,
            maxDownloads: link.maxDownloads,
            downloadCount: link.downloadCount,
            revokedAt: link.revokedAt,
            createdAt: link.createdAt,
          })),
        },
        'Share links retrieved successfully',
        requestId
      )
    );
  }),

  revokeShareLink: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { shareLinkId } = req.params;

    await shareLinkService.revokeShareLink(shareLinkId, userId, requestId);

    log.info({ shareLinkId }, 'Share link revoked');

    res.json(
      successResponse(
        null,
        'Share link revoked successfully',
        requestId
      )
    );
  }),

  // Public access route - no authentication required
  accessShareLink: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;
    const log = createRequestLogger(requestId);
    req.logger = log;

    const { token } = req.params;

    const result = await shareLinkService.validateShareLinkAccess(token, 'read', sharePassword(req));

    await shareLinkService.logShareAccess(result.shareLink, result.file, req.ip, requestId);

    log.info({ shareLinkId: result.shareLink.id }, 'Share link accessed');

    // Return minimal file info
    res.json(
      successResponse(
        {
          file: {
            id: result.file.id,
            filename: result.file.filename,
            sizeBytes: result.file.sizeBytes.toString(),
            mimeType: result.file.mimeType,
            category: result.file.category,
          },
          permission: result.shareLink.permission,
          expiresAt: result.shareLink.expiresAt,
          requiresPassword: !!result.shareLink.passwordHash,
          downloadsRemaining:
            result.shareLink.maxDownloads === null ? null : Math.max(0, result.shareLink.maxDownloads - result.shareLink.downloadCount),
        },
        'Share link accessed successfully',
        requestId
      )
    );
  }),

  // Download via share link
  downloadShareLink: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;
    const log = createRequestLogger(requestId);
    req.logger = log;

    const { token } = req.params;

    const result = await shareLinkService.validateShareLinkAccess(token, 'download', sharePassword(req));

    log.info({ shareLinkId: result.shareLink.id }, 'Share link download initiated');

    // Presigned URLs cannot be revoked once issued, so they are short-lived
    // (DOWNLOAD_URL_TTL_SECONDS). The URL is created first so that a storage failure does not
    // consume a download, and released only after the atomic limit check succeeds.
    const { url, expiresIn } = await presignFileDownload(result.file);

    await shareLinkService.consumeDownload(result.shareLink.id);

    await activityLogService.logActivity(null, 'file_download', {
      resourceType: 'FILE',
      resourceId: result.file.id,
      targetOwnerId: result.file.ownerId,
      ipAddress: req.ip,
      metadata: { filename: result.file.filename, viaShareLink: result.shareLink.id },
      requestId,
    });

    res.json(
      successResponse(
        {
          downloadUrl: url,
          expiresIn,
          filename: result.file.filename,
          sizeBytes: result.file.sizeBytes.toString(),
          mimeType: result.file.mimeType,
        },
        'Download URL generated successfully',
        requestId
      )
    );
  }),
};