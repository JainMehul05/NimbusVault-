import type { PrismaClient, File, Folder, Permission, ShareLink } from '@prisma/client';
import { AppError } from './errors';
import { ErrorCodes } from './errors';
import prisma from '@database/prisma';
import bcrypt from 'bcrypt';

export type ResourceType = 'FILE' | 'FOLDER';
export type Action =
  | 'read'
  | 'download'
  | 'write'
  | 'rename'
  | 'move'
  | 'delete'
  | 'share'
  | 'manage_permissions'
  | 'create_share_link'
  | 'revoke_share_link'
  | 'view_activity';

export type PermissionLevel = 'VIEWER' | 'EDITOR' | 'OWNER';

export interface AuthorizationContext {
  userId: string;
  userEmail?: string;
  isAuthenticated: boolean;
}

export interface ResourceAccess {
  file?: File;
  folder?: Folder;
  shareLink?: ShareLink;
  permission?: Permission;
  effectiveLevel: PermissionLevel;
  isOwner: boolean;
  isPublicAccess: boolean;
}

export const PermissionMatrix: Record<PermissionLevel, Action[]> = {
  OWNER: [
    'read',
    'download',
    'write',
    'rename',
    'move',
    'delete',
    'share',
    'manage_permissions',
    'create_share_link',
    'revoke_share_link',
    'view_activity',
  ],
  EDITOR: [
    'read',
    'download',
    'write',
    'rename',
    'move',
    'share', // Editors can share with others (configurable)
    'create_share_link', // Editors can create public share links
  ],
  VIEWER: [
    'read',
    'download',
  ],
};

export function hasPermission(level: PermissionLevel, action: Action): boolean {
  return PermissionMatrix[level]?.includes(action) ?? false;
}

export class AuthorizationService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async getFileAccess(userId: string, fileId: string): Promise<ResourceAccess> {
    const file = await this.prismaClient.file.findUnique({
      where: { id: fileId },
      include: { folder: true },
    });

    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    if (file.deletedAt) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    const isOwner = file.ownerId === userId;

    if (isOwner) {
      return {
        file,
        effectiveLevel: 'OWNER',
        isOwner: true,
        isPublicAccess: false,
      };
    }

    // Check direct permission
    const permission = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType: 'FILE',
          resourceId: fileId,
          granteeUserId: userId,
        },
      },
    });

    if (permission) {
      return {
        file,
        permission,
        effectiveLevel: permission.level,
        isOwner: false,
        isPublicAccess: false,
      };
    }

    // Check inherited permission from parent folder
    if (file.folderId) {
      const folderAccess = await this.getFolderAccess(userId, file.folderId);
      // Grant inherited access if user has any access to the folder (direct or inherited)
      // The getFolderAccess method throws if no access, so if it returns, user has access
      return {
        file,
        effectiveLevel: folderAccess.effectiveLevel,
        isOwner: false,
        isPublicAccess: false,
      };
    }

    throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
  }

  async getFolderAccess(userId: string, folderId: string): Promise<ResourceAccess> {
    const folder = await this.prismaClient.folder.findUnique({
      where: { id: folderId },
    });

    if (!folder) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    if (folder.deletedAt) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    const isOwner = folder.ownerId === userId;

    if (isOwner) {
      return {
        folder,
        effectiveLevel: 'OWNER',
        isOwner: true,
        isPublicAccess: false,
      };
    }

    // Check direct permission
    const permission = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType: 'FOLDER',
          resourceId: folderId,
          granteeUserId: userId,
        },
      },
    });

    if (permission) {
      return {
        folder,
        permission,
        effectiveLevel: permission.level,
        isOwner: false,
        isPublicAccess: false,
      };
    }

    // Check inherited permission from parent folder
    if (folder.parentFolderId) {
      const parentAccess = await this.getFolderAccess(userId, folder.parentFolderId);
      // Only grant inherited access if user has explicit permission on parent folder
      // or if parent access level is EDITOR or OWNER
      if (parentAccess.permission || parentAccess.effectiveLevel === 'EDITOR' || parentAccess.effectiveLevel === 'OWNER') {
        return {
          folder,
          effectiveLevel: parentAccess.effectiveLevel,
          isOwner: false,
          isPublicAccess: false,
        };
      }
    }

    throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
  }

  async authorizeFileAccess(
    context: AuthorizationContext,
    fileId: string,
    action: Action
  ): Promise<ResourceAccess> {
    if (!context.isAuthenticated) {
      throw AppError.unauthorized('Authentication required', 'TOKEN_REQUIRED');
    }

    const access = await this.getFileAccess(context.userId, fileId);

    if (!hasPermission(access.effectiveLevel, action)) {
      throw AppError.forbidden(
        `Insufficient permissions to ${action} this file`,
        ErrorCodes.FORBIDDEN,
        { required: action, current: access.effectiveLevel }
      );
    }

    return access;
  }

  async authorizeFolderAccess(
    context: AuthorizationContext,
    folderId: string,
    action: Action
  ): Promise<ResourceAccess> {
    if (!context.isAuthenticated) {
      throw AppError.unauthorized('Authentication required', 'TOKEN_REQUIRED');
    }

    const access = await this.getFolderAccess(context.userId, folderId);

    if (!hasPermission(access.effectiveLevel, action)) {
      throw AppError.forbidden(
        `Insufficient permissions to ${action} this folder`,
        ErrorCodes.FORBIDDEN,
        { required: action, current: access.effectiveLevel }
      );
    }

    return access;
  }

  async getEffectivePermissionLevel(
    userId: string,
    resourceType: ResourceType,
    resourceId: string
  ): Promise<PermissionLevel | null> {
    if (resourceType === 'FILE') {
      const file = await this.prismaClient.file.findUnique({
        where: { id: resourceId },
        select: { ownerId: true, folderId: true, deletedAt: true },
      });

      if (!file || file.deletedAt) return null;

      if (file.ownerId === userId) return 'OWNER';

      const permission = await this.prismaClient.permission.findUnique({
        where: {
          resourceType_resourceId_granteeUserId: {
            resourceType: 'FILE',
            resourceId,
            granteeUserId: userId,
          },
        },
      });

      if (permission) return permission.level;

      if (file.folderId) {
        return this.getEffectivePermissionLevel(userId, 'FOLDER', file.folderId);
      }

      return null;
    } else {
      const folder = await this.prismaClient.folder.findUnique({
        where: { id: resourceId },
        select: { ownerId: true, parentFolderId: true, deletedAt: true },
      });

      if (!folder || folder.deletedAt) return null;

      if (folder.ownerId === userId) return 'OWNER';

      const permission = await this.prismaClient.permission.findUnique({
        where: {
          resourceType_resourceId_granteeUserId: {
            resourceType: 'FOLDER',
            resourceId,
            granteeUserId: userId,
          },
        },
      });

      if (permission) return permission.level;

      if (folder.parentFolderId) {
        return this.getEffectivePermissionLevel(userId, 'FOLDER', folder.parentFolderId);
      }

      return null;
    }
  }

  async listUserAccessibleFiles(
    userId: string,
    options: { folderId?: string | null } = {}
  ): Promise<{ fileIds: string[]; folderIds: string[] }> {
    // Get files user owns
    const ownedFiles = await this.prismaClient.file.findMany({
      where: { ownerId: userId, deletedAt: null, ...(options.folderId !== undefined ? { folderId: options.folderId } : {}) },
      select: { id: true },
    });

    // Get files user has direct permission on
    const directFilePermissions = await this.prismaClient.permission.findMany({
      where: { granteeUserId: userId, resourceType: 'FILE' },
      select: { resourceId: true },
    });

    // Get folders user owns
    const ownedFolders = await this.prismaClient.folder.findMany({
      where: { ownerId: userId, deletedAt: null, ...(options.folderId !== undefined ? { parentFolderId: options.folderId } : {}) },
      select: { id: true },
    });

    // Get folders user has direct permission on
    const directFolderPermissions = await this.prismaClient.permission.findMany({
      where: { granteeUserId: userId, resourceType: 'FOLDER' },
      select: { resourceId: true },
    });

    // Get files in folders user has access to (inherited)
    const accessibleFolderIds = [...ownedFolders.map(f => f.id), ...directFolderPermissions.map(p => p.resourceId)];
    let inheritedFiles: string[] = [];
    if (accessibleFolderIds.length > 0) {
      const inherited = await this.prismaClient.file.findMany({
        where: { folderId: { in: accessibleFolderIds }, deletedAt: null },
        select: { id: true },
      });
      inheritedFiles = inherited.map(f => f.id);
    }

    const fileIds = [
      ...ownedFiles.map(f => f.id),
      ...directFilePermissions.map(p => p.resourceId),
      ...inheritedFiles,
    ];

    const folderIds = [...ownedFolders.map(f => f.id), ...directFolderPermissions.map(p => p.resourceId)];

    return {
      fileIds: [...new Set(fileIds)],
      folderIds: [...new Set(folderIds)],
    };
  }

  async validateShareLinkAccess(
    token: string,
    action: 'read' | 'download' = 'read'
  ): Promise<{ shareLink: ShareLink; file: File }> {
    // Find share link by token hash - check all links (including expired/revoked)
    // Expired/revoked links are checked after token verification to return proper error
    const shareLinks = await this.prismaClient.shareLink.findMany({
      include: { file: true },
    });

    let shareLink: ShareLink & { file: File } | null = null;

    for (const link of shareLinks) {
      // Verify token using bcrypt (tokens are stored as bcrypt hashes)
      const isValid = await bcrypt.compare(token, link.token);
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

    // Check permission
    const hasDownloadPerm = shareLink.permission === 'DOWNLOAD';
    if (action === 'download' && !hasDownloadPerm) {
      throw AppError.forbidden('Download not permitted for this share link', ErrorCodes.FORBIDDEN);
    }

    return { shareLink, file: shareLink.file };
  }
}

export const authorizationService = new AuthorizationService();