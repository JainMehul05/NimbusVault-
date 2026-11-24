import type { PrismaClient, ShareLink, SharePermission, File } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '@database/prisma';
import { authorizationService } from '@common/authorization';
import { createRequestLogger } from '@common/logger';
import { config } from '@config/index';
import { activityLogService } from '@modules/activity/activity.service';

export interface CreateShareLinkInput {
  fileId: string;
  createdBy: string;
  permission: SharePermission;
  password?: string;
  expiresAt?: Date;
  maxDownloads?: number;
  requestId?: string;
}

export interface ShareLinkResult {
  id: string;
  token: string;
  permission: SharePermission;
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: Date;
  url: string;
}

const BCRYPT_PREFIX = /^\$2[aby]\$\d+\$/;

export class ShareLinkService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Deterministic, non-reversible lookup key for a 256-bit random token. Lets a public request
   * find its link with one indexed query instead of bcrypt-comparing against every link
   * (which was O(n) CPU per request and an easy denial-of-service).
   */
  static lookupKey(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, config.bcrypt.rounds);
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcrypt.rounds);
  }

  async createShareLink(input: CreateShareLinkInput): Promise<ShareLinkResult> {
    const log = input.requestId ? createRequestLogger(input.requestId) : undefined;

    const access = await authorizationService.authorizeFileAccess(
      { userId: input.createdBy, isAuthenticated: true },
      input.fileId,
      'create_share_link'
    );

    const token = this.generateToken();
    const tokenHash = await this.hashToken(token);
    const passwordHash = input.password ? await this.hashPassword(input.password) : null;

    const shareLink = await this.prismaClient.shareLink.create({
      data: {
        fileId: input.fileId,
        createdBy: input.createdBy,
        token: tokenHash,
        tokenLookup: ShareLinkService.lookupKey(token),
        permission: input.permission,
        passwordHash,
        expiresAt: input.expiresAt ?? null,
        maxDownloads: input.maxDownloads ?? null,
      },
    });

    log?.info({ shareLinkId: shareLink.id, fileId: input.fileId, permission: input.permission }, 'Share link created');

    await activityLogService.logActivity(input.createdBy, 'share_link_create', {
      resourceType: 'SHARE_LINK',
      resourceId: shareLink.id,
      targetOwnerId: access.file!.ownerId,
      metadata: {
        fileId: input.fileId,
        filename: access.file!.filename,
        permission: input.permission,
        expiresAt: input.expiresAt?.toISOString() ?? null,
        maxDownloads: input.maxDownloads ?? null,
        passwordProtected: !!passwordHash,
      },
      requestId: input.requestId,
    });

    const baseUrl = config.frontend.url;
    const url = `${baseUrl}/share/${token}`;

    return {
      id: shareLink.id,
      token,
      permission: shareLink.permission,
      expiresAt: shareLink.expiresAt,
      maxDownloads: shareLink.maxDownloads,
      downloadCount: shareLink.downloadCount,
      createdAt: shareLink.createdAt,
      url,
    };
  }

  /** Links for a file. Visible to people who may create links (owner, editors). Tokens are never returned. */
  async listShareLinks(fileId: string, userId: string, _requestId?: string): Promise<ShareLink[]> {
    await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'create_share_link');

    const shareLinks = await this.prismaClient.shareLink.findMany({
      where: { fileId },
      orderBy: { createdAt: 'desc' },
    });

    return shareLinks.map((link) => ({ ...link, token: '', tokenLookup: null }));
  }

  /** The link's creator or the file's owner may revoke it. */
  async revokeShareLink(shareLinkId: string, userId: string, requestId?: string): Promise<void> {
    const log = requestId ? createRequestLogger(requestId) : undefined;

    const shareLink = await this.prismaClient.shareLink.findUnique({
      where: { id: shareLinkId },
      include: { file: true },
    });

    if (!shareLink) {
      throw AppError.notFound('Share link not found', ErrorCodes.SHARE_NOT_FOUND);
    }

    const isOwner = shareLink.file.ownerId === userId;
    if (shareLink.createdBy !== userId && !isOwner) {
      throw AppError.forbidden('Only the creator or the file owner can revoke this share link', ErrorCodes.FORBIDDEN);
    }

    if (shareLink.revokedAt) {
      throw AppError.badRequest('Share link already revoked', ErrorCodes.VALIDATION_ERROR);
    }

    await this.prismaClient.shareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() },
    });

    log?.info({ shareLinkId }, 'Share link revoked');

    await activityLogService.logActivity(userId, 'share_link_revoke', {
      resourceType: 'SHARE_LINK',
      resourceId: shareLinkId,
      targetOwnerId: shareLink.file.ownerId,
      metadata: { fileId: shareLink.fileId, filename: shareLink.file.filename },
      requestId,
    });
  }

  private async findByToken(token: string): Promise<(ShareLink & { file: File }) | null> {
    // Tokens are 32 random bytes in base64url; anything else cannot be valid.
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;

    const byLookup = await this.prismaClient.shareLink.findUnique({
      where: { tokenLookup: ShareLinkService.lookupKey(token) },
      include: { file: true },
    });
    if (byLookup) {
      // Defence in depth: the bcrypt hash must also match.
      return (await bcrypt.compare(token, byLookup.token)) ? byLookup : null;
    }

    // Links created before lookup keys existed: bcrypt-compare only those legacy rows, then
    // backfill the key so each legacy link pays this cost at most once.
    const legacy = await this.prismaClient.shareLink.findMany({
      where: { tokenLookup: null },
      include: { file: true },
    });
    for (const link of legacy) {
      if (!BCRYPT_PREFIX.test(link.token)) continue; // plaintext legacy tokens are not honoured
      if (await bcrypt.compare(token, link.token)) {
        await this.prismaClient.shareLink
          .update({ where: { id: link.id }, data: { tokenLookup: ShareLinkService.lookupKey(token) } })
          .catch(() => {});
        return link;
      }
    }
    return null;
  }

  async validateShareLinkAccess(
    token: string,
    action: 'read' | 'download' = 'read',
    password?: string
  ): Promise<{ shareLink: ShareLink; file: File }> {
    const shareLink = await this.findByToken(token);

    if (!shareLink) {
      throw AppError.notFound('Invalid share link', ErrorCodes.SHARE_NOT_FOUND);
    }

    if (shareLink.revokedAt) {
      throw AppError.forbidden('Share link has been revoked', ErrorCodes.SHARE_REVOKED);
    }

    if (shareLink.expiresAt && new Date() > shareLink.expiresAt) {
      throw AppError.forbidden('Share link has expired', ErrorCodes.SHARE_EXPIRED);
    }

    if (shareLink.maxDownloads && shareLink.downloadCount >= shareLink.maxDownloads) {
      throw AppError.forbidden('Share link download limit exceeded', ErrorCodes.SHARE_EXHAUSTED);
    }

    if (shareLink.file.deletedAt || shareLink.file.status !== 'READY') {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    if (shareLink.passwordHash) {
      if (!password) {
        throw AppError.forbidden('Password required', ErrorCodes.PASSWORD_REQUIRED);
      }
      if (!(await bcrypt.compare(password, shareLink.passwordHash))) {
        throw AppError.forbidden('Invalid password', ErrorCodes.INVALID_PASSWORD);
      }
    }

    if (action === 'download' && shareLink.permission !== 'DOWNLOAD') {
      throw AppError.forbidden('Download not permitted for this share link', ErrorCodes.FORBIDDEN);
    }

    return { shareLink, file: shareLink.file };
  }

  /**
   * Atomically consumes one download. The limit is enforced in the UPDATE itself, so two
   * concurrent requests cannot both take the last remaining download.
   */
  async consumeDownload(shareLinkId: string): Promise<void> {
    const updated = await this.prismaClient.$executeRaw`
      UPDATE "share_links" SET "downloadCount" = "downloadCount" + 1
      WHERE "id" = ${shareLinkId} AND "revokedAt" IS NULL
        AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")`;
    if (updated === 0) {
      throw AppError.forbidden('Share link download limit exceeded', ErrorCodes.SHARE_EXHAUSTED);
    }
  }

  /** @deprecated use consumeDownload (atomic) */
  async incrementDownloadCount(shareLinkId: string): Promise<void> {
    await this.consumeDownload(shareLinkId);
  }

  /** Anonymous visit: attributed to the file owner's feed, never to an invented actor. */
  async logShareAccess(shareLink: ShareLink, file: File, ipAddress?: string, requestId?: string): Promise<void> {
    await activityLogService.logActivity(null, 'share_access', {
      resourceType: 'SHARE_LINK',
      resourceId: shareLink.id,
      targetOwnerId: file.ownerId,
      ipAddress,
      metadata: { fileId: file.id, filename: file.filename },
      requestId,
    });
  }
}

export const shareLinkService = new ShareLinkService();
