import type { PrismaClient, Permission, PermissionLevel, ResourceType } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { createRequestLogger } from '@common/logger';
import { authorizationService, hasPermission } from '@common/authorization';

export interface CreateShareInput {
  resourceType: ResourceType;
  resourceId: string;
  granteeEmail: string;
  level: PermissionLevel;
  grantedBy: string;
  requestId?: string;
}

export interface UpdateShareInput {
  level: PermissionLevel;
}

export interface ShareResult {
  permission: Permission;
  grantee: { id: string; name: string; email: string };
}

export class SharingService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  getPrismaClient(): PrismaClient {
    return this.prismaClient;
  }

  private async findUserByEmail(email: string) {
    return this.prismaClient.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });
  }

  private async validateResourceSharePermission(
    resourceType: ResourceType,
    resourceId: string,
    userId: string
  ): Promise<void> {
    if (resourceType === 'FILE') {
      const access = await authorizationService.getFileAccess(userId, resourceId);
      if (!hasPermission(access.effectiveLevel, 'share')) {
        throw AppError.forbidden('Insufficient permissions to manage sharing', ErrorCodes.FORBIDDEN);
      }
    } else {
      const access = await authorizationService.getFolderAccess(userId, resourceId);
      if (!hasPermission(access.effectiveLevel, 'share')) {
        throw AppError.forbidden('Insufficient permissions to manage sharing', ErrorCodes.FORBIDDEN);
      }
    }
  }

  async createOrUpdateShare(input: CreateShareInput): Promise<ShareResult> {
    const log = input.requestId ? createRequestLogger(input.requestId) : undefined;

    // Validate grantee exists
    const grantee = await this.findUserByEmail(input.granteeEmail);
    if (!grantee) {
      throw AppError.notFound('User not found', ErrorCodes.NOT_OWNER);
    }

    // Prevent sharing with self
    if (grantee.id === input.grantedBy) {
      throw AppError.badRequest('Cannot share with yourself', ErrorCodes.VALIDATION_ERROR);
    }

    // Validate resource ownership
    await this.validateResourceSharePermission(input.resourceType, input.resourceId, input.grantedBy);

    // Check if share already exists
    const existingPermission = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          granteeUserId: grantee.id,
        },
      },
    });

    let permission: Permission;

    if (existingPermission) {
      // Update existing permission
      permission = await this.prismaClient.permission.update({
        where: {
          resourceType_resourceId_granteeUserId: {
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            granteeUserId: grantee.id,
          },
        },
        data: { level: input.level },
      });
      log?.info(
        { resourceType: input.resourceType, resourceId: input.resourceId, granteeId: grantee.id, level: input.level },
        'Share permission updated'
      );
    } else {
      // Create new permission
      permission = await this.prismaClient.permission.create({
        data: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          granteeUserId: grantee.id,
          level: input.level,
          grantedBy: input.grantedBy,
        },
      });
      log?.info(
        { resourceType: input.resourceType, resourceId: input.resourceId, granteeId: grantee.id, level: input.level },
        'Share permission created'
      );
    }

    // Log activity
    await this.prismaClient.activityLog.create({
      data: {
        userId: input.grantedBy,
        action: existingPermission ? 'share_revoke' : 'share_create', // We'll use share_create for both
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: { granteeId: grantee.id, level: input.level, updated: !!existingPermission },
      },
    });

    return { permission, grantee };
  }

  async listShares(resourceType: ResourceType, resourceId: string, userId: string): Promise<Array<Permission & { grantee: { id: string; name: string; email: string } }>> {
    // Validate share permission
    await this.validateResourceSharePermission(resourceType, resourceId, userId);

    const permissions = await this.prismaClient.permission.findMany({
      where: { resourceType, resourceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return permissions.map(p => ({
      id: p.id,
      resourceType: p.resourceType,
      resourceId: p.resourceId,
      granteeUserId: p.granteeUserId,
      level: p.level,
      grantedBy: p.grantedBy,
      createdAt: p.createdAt,
      grantee: { id: p.user.id, name: p.user.name, email: p.user.email },
    }));
  }

  async updateShare(
    resourceType: ResourceType,
    resourceId: string,
    granteeId: string,
    level: PermissionLevel,
    userId: string,
    requestId?: string
  ): Promise<Permission> {
    const log = requestId ? createRequestLogger(requestId) : undefined;

    // Validate share permission
    await this.validateResourceSharePermission(resourceType, resourceId, userId);

    // Check if permission exists
    const existing = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType,
          resourceId,
          granteeUserId: granteeId,
        },
      },
    });

    if (!existing) {
      throw AppError.notFound('Share not found', ErrorCodes.SHARE_NOT_FOUND);
    }

    const permission = await this.prismaClient.permission.update({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType,
          resourceId,
          granteeUserId: granteeId,
        },
      },
      data: { level },
    });

    log?.info(
      { resourceType, resourceId, granteeId, level, previousLevel: existing.level },
      'Share permission updated'
    );

    // Log activity
    await this.prismaClient.activityLog.create({
      data: {
        userId,
        action: 'share_revoke', // Using existing action type
        resourceType,
        resourceId,
        metadata: { granteeId, level, previousLevel: existing.level },
      },
    });

    return permission;
  }

  async revokeShare(
    resourceType: ResourceType,
    resourceId: string,
    granteeId: string,
    userId: string,
    requestId?: string
  ): Promise<void> {
    const log = requestId ? createRequestLogger(requestId) : undefined;

    // Validate share permission
    await this.validateResourceSharePermission(resourceType, resourceId, userId);

    const existing = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType,
          resourceId,
          granteeUserId: granteeId,
        },
      },
    });

    if (!existing) {
      throw AppError.notFound('Share not found', ErrorCodes.SHARE_NOT_FOUND);
    }

    await this.prismaClient.permission.delete({
      where: {
        resourceType_resourceId_granteeUserId: {
          resourceType,
          resourceId,
          granteeUserId: granteeId,
        },
      },
    });

    log?.info({ resourceType, resourceId, granteeId }, 'Share permission revoked');

    // Log activity
    await this.prismaClient.activityLog.create({
      data: {
        userId,
        action: 'share_revoke',
        resourceType,
        resourceId,
        metadata: { granteeId, previousLevel: existing.level },
      },
    });
  }

  async listResourcesSharedWithUser(userId: string): Promise<{
    files: Array<{ id: string; filename: string; sizeBytes: bigint; mimeType: string; category: string; folderId: string | null; permission: PermissionLevel; owner: { id: string; name: string; email: string } }>;
    folders: Array<{ id: string; name: string; permission: PermissionLevel; owner: { id: string; name: string; email: string } }>;
  }> {
    // Get direct file permissions
    const filePermissions = await this.prismaClient.permission.findMany({
      where: { granteeUserId: userId, resourceType: 'FILE' },
    });

    // Get direct folder permissions
    const folderPermissions = await this.prismaClient.permission.findMany({
      where: { granteeUserId: userId, resourceType: 'FOLDER' },
    });

    // Get file details for file permissions
    const fileIds = filePermissions.map(p => p.resourceId);
    const files = await this.prismaClient.file.findMany({
      where: { id: { in: fileIds }, deletedAt: null },
      select: { id: true, filename: true, sizeBytes: true, mimeType: true, category: true, folderId: true, ownerId: true },
    });
    const fileMap = new Map(files.map(f => [f.id, f]));

    // Get folder details for folder permissions
    const folderIds = folderPermissions.map(p => p.resourceId);
    const folders = await this.prismaClient.folder.findMany({
      where: { id: { in: folderIds }, deletedAt: null },
      select: { id: true, name: true, ownerId: true },
    });
    const folderMap = new Map(folders.map(f => [f.id, f]));

    // Get owner info for files
    const fileOwnerIds = [...new Set(files.map(f => f.ownerId))];
    const fileOwners = await this.prismaClient.user.findMany({
      where: { id: { in: fileOwnerIds } },
      select: { id: true, name: true, email: true },
    });
    const fileOwnerMap = new Map(fileOwners.map(o => [o.id, o]));

    // Get owner info for folders
    const folderOwnerIds = [...new Set(folders.map(f => f.ownerId))];
    const folderOwners = await this.prismaClient.user.findMany({
      where: { id: { in: folderOwnerIds } },
      select: { id: true, name: true, email: true },
    });
    const folderOwnerMap = new Map(folderOwners.map(o => [o.id, o]));

    // Also get files in shared folders (inherited access)
    const sharedFolderIds = folderPermissions
      .map(p => p.resourceId)
      .filter(id => folderMap.has(id));

    // Create a map of folderId -> permission level for inherited access
    const folderPermissionMap = new Map<string, PermissionLevel>();
    folderPermissions
      .filter(p => folderMap.has(p.resourceId))
      .forEach(p => {
        folderPermissionMap.set(p.resourceId, p.level);
      });

    let inheritedFiles: Array<{ id: string; filename: string; sizeBytes: bigint; mimeType: string; category: string; folderId: string | null; ownerId: string }> = [];
    if (sharedFolderIds.length > 0) {
      inheritedFiles = await this.prismaClient.file.findMany({
        where: { folderId: { in: sharedFolderIds }, deletedAt: null },
        select: { id: true, filename: true, sizeBytes: true, mimeType: true, category: true, folderId: true, ownerId: true },
      });

      // Add owners of inherited files
      const inheritedOwnerIds = [...new Set(inheritedFiles.map(f => f.ownerId))];
      const inheritedOwners = await this.prismaClient.user.findMany({
        where: { id: { in: inheritedOwnerIds } },
        select: { id: true, name: true, email: true },
      });
      inheritedOwners.forEach(o => fileOwnerMap.set(o.id, o));
    }

    const fileResults = filePermissions
      .map(p => {
        const file = fileMap.get(p.resourceId);
        if (!file) return null;
        return {
          id: file.id,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          category: file.category,
          folderId: file.folderId,
          permission: p.level,
          owner: fileOwnerMap.get(file.ownerId)!,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const inheritedFileResults = inheritedFiles.map(f => ({
      id: f.id,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
      mimeType: f.mimeType,
      category: f.category,
      folderId: f.folderId,
      // Inherit the permission level from the parent folder
      permission: f.folderId ? (folderPermissionMap.get(f.folderId) ?? ('VIEWER' as PermissionLevel)) : ('VIEWER' as PermissionLevel),
      owner: fileOwnerMap.get(f.ownerId)!,
    }));

    const folderResults = folderPermissions
      .map(p => {
        const folder = folderMap.get(p.resourceId);
        if (!folder) return null;
        return {
          id: folder.id,
          name: folder.name,
          permission: p.level,
          owner: folderOwnerMap.get(folder.ownerId)!,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return { files: [...fileResults, ...inheritedFileResults], folders: folderResults };
  }

  async listResourcesSharedByUser(userId: string): Promise<{
    files: Array<{ id: string; filename: string; shares: Array<{ grantee: { id: string; name: string; email: string }; level: PermissionLevel }> }>;
    folders: Array<{ id: string; name: string; shares: Array<{ grantee: { id: string; name: string; email: string }; level: PermissionLevel }> }>;
  }> {
    // Get files owned by user
    const files = await this.prismaClient.file.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, filename: true },
    });

    // Get folders owned by user
    const folders = await this.prismaClient.folder.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, name: true },
    });

    // Get file permissions for these files
    const fileIds = files.map(f => f.id);
    const folderIds = folders.map(f => f.id);

    const filePermissions = await this.prismaClient.permission.findMany({
      where: { resourceType: 'FILE', resourceId: { in: fileIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const folderPermissions = await this.prismaClient.permission.findMany({
      where: { resourceType: 'FOLDER', resourceId: { in: folderIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Group permissions by resource
    const filePermsByResource = new Map<string, Array<{ grantee: { id: string; name: string; email: string }; level: PermissionLevel }>>();
    for (const p of filePermissions) {
      if (!filePermsByResource.has(p.resourceId)) {
        filePermsByResource.set(p.resourceId, []);
      }
      filePermsByResource.get(p.resourceId)!.push({
        grantee: { id: p.user.id, name: p.user.name, email: p.user.email },
        level: p.level,
      });
    }

    const folderPermsByResource = new Map<string, Array<{ grantee: { id: string; name: string; email: string }; level: PermissionLevel }>>();
    for (const p of folderPermissions) {
      if (!folderPermsByResource.has(p.resourceId)) {
        folderPermsByResource.set(p.resourceId, []);
      }
      folderPermsByResource.get(p.resourceId)!.push({
        grantee: { id: p.user.id, name: p.user.name, email: p.user.email },
        level: p.level,
      });
    }

    return {
      files: files
        .filter(f => filePermsByResource.has(f.id))
        .map(f => ({
          id: f.id,
          filename: f.filename,
          shares: filePermsByResource.get(f.id)!,
        })),
      folders: folders
        .filter(f => folderPermsByResource.has(f.id))
        .map(f => ({
          id: f.id,
          name: f.name,
          shares: folderPermsByResource.get(f.id)!,
        })),
    };
  }
}

export const sharingService = new SharingService();