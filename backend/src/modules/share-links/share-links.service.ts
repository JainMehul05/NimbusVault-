import type { PrismaClient, ShareLink, SharePermission, File } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '@database/prisma';
import { authorizationService } from '@common/authorization';
import { createRequestLogger } from '@common/logger';
import { config } from '@config/index';

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

export class ShareLinkService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, config.bcrypt.rounds);
  }

  private async verifyToken(token: string, tokenHash: string): Promise<boolean> {
    return bcrypt.compare(token, tokenHash);
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcrypt.rounds);
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  async createShareLink(input: CreateShareLinkInput): Promise<ShareLinkResult> {
    const log = input.requestId ? createRequestLogger(input.requestId) : undefined;

    // Validate file access and permission to create share link
    await authorizationService.authorizeFileAccess(
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
        permission: input.permission,
        passwordHash,
        expiresAt: input.expiresAt ?? null,
        maxDownloads: input.maxDownloads ?? null,
      },
    });

    log?.info(
      { shareLinkId: shareLink.id, fileId: input.fileId, permission: input.permission, expiresAt: input.expiresAt },
      'Share link created'
    );

    // Log activity
    await this.prismaClient.activityLog.create({
      data: {
        userId: input.createdBy,
        action: 'share_create',
        resourceType: 'SHARE_LINK',
        resourceId: shareLink.id,
        metadata: { fileId: input.fileId, permission: input.permission, expiresAt: input.expiresAt },
      },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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

  async listShareLinks(fileId: string, userId: string, _requestId?: string): Promise<ShareLink[]> {
    // Validate file ownership
    await authorizationService.authorizeFileAccess(
      { userId, isAuthenticated: true },
      fileId,
      'read'
    );

    const shareLinks = await this.prismaClient.shareLink.findMany({
      where: { fileId },
      orderBy: { createdAt: 'desc' },
    });

    // Don't expose tokens in list view (tokens are now hashed)
    return shareLinks.map(link => ({
      ...link,
      token: '',
    }));
  }

  async revokeShareLink(shareLinkId: string, userId: string, requestId?: string): Promise<void> {
    const log = requestId ? createRequestLogger(requestId) : undefined;

    const shareLink = await this.prismaClient.shareLink.findUnique({
      where: { id: shareLinkId },
      include: { file: true },
    });

    if (!shareLink) {
      throw AppError.notFound('Share link not found', ErrorCodes.SHARE_NOT_FOUND);
    }

    // Verify ownership
    if (shareLink.createdBy !== userId) {
      throw AppError.forbidden('Only the creator can revoke this share link', ErrorCodes.FORBIDDEN);
    }

    if (shareLink.revokedAt) {
      throw AppError.badRequest('Share link already revoked', ErrorCodes.VALIDATION_ERROR);
    }

    await this.prismaClient.shareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() },
    });

    log?.info({ shareLinkId }, 'Share link revoked');

    // Log activity
    await this.prismaClient.activityLog.create({
      data: {
        userId,
        action: 'share_revoke',
        resourceType: 'SHARE_LINK',
        resourceId: shareLinkId,
        metadata: { fileId: shareLink.fileId },
      },
    });
  }

  async validateShareLinkAccess(
    token: string,
    action: 'read' | 'download' = 'read',
    password?: string
  ): Promise<{ shareLink: ShareLink; file: File }> {
    // Find share link by token hash - we need to check all links (including expired/revoked)
    // Expired/revoked links are checked after token verification to return proper error
    const shareLinks = await this.prismaClient.shareLink.findMany({
      include: { file: true },
    });

    let shareLink: ShareLink & { file: File } | null = null;

    for (const link of shareLinks) {
      // Verify token using bcrypt (all tokens are now stored as bcrypt hashes)
      // High-entropy tokens (32 bytes = 256 bits) are not susceptible to brute-force,
      // so bcrypt's computational cost is acceptable and provides defense-in-depth.
      const isValid = await this.verifyToken(token, link.token);
      
      if (isValid) {
        shareLink = link;
        break;
      }
    }

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

    if (shareLink.file.deletedAt) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    // Check password if required - passwords are stored as bcrypt hashes
    if (shareLink.passwordHash) {
      if (!password) {
        throw AppError.forbidden('Password required', ErrorCodes.PASSWORD_REQUIRED);
      }
      
      const passwordValid = await this.verifyPassword(password, shareLink.passwordHash);
      
      if (!passwordValid) {
        throw AppError.forbidden('Invalid password', ErrorCodes.INVALID_PASSWORD);
      }
    }

    // Check permission
    if (action === 'download' && shareLink.permission !== 'DOWNLOAD') {
      throw AppError.forbidden('Download not permitted for this share link', ErrorCodes.FORBIDDEN);
    }

    return { shareLink, file: shareLink.file };
  }

  async incrementDownloadCount(shareLinkId: string): Promise<void> {
    await this.prismaClient.shareLink.update({
      where: { id: shareLinkId },
      data: { downloadCount: { increment: 1 } },
    });
  }

  async logShareAccess(shareLinkId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.prismaClient.activityLog.create({
      data: {
        action: 'share_access',
        resourceType: 'SHARE_LINK',
        resourceId: shareLinkId,
        ipAddress,
        metadata: { userAgent },
      },
    });
  }
}

export const shareLinkService = new ShareLinkService();