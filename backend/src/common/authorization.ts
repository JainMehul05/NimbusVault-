import { Prisma } from '@prisma/client';
import type { PrismaClient, File, Folder, Permission, ShareLink } from '@prisma/client';
import { AppError } from './errors';
import { ErrorCodes } from './errors';
import prisma from '@database/prisma';

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
    'share', // Editors can grant access to others (but cannot change or revoke existing grants)
    'create_share_link', // Editors can create public share links
  ],
  VIEWER: ['read', 'download'],
};

const RANK: Record<PermissionLevel, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function hasPermission(level: PermissionLevel, action: Action): boolean {
  return PermissionMatrix[level]?.includes(action) ?? false;
}

export function strongerLevel(a: PermissionLevel | null, b: PermissionLevel | null): PermissionLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** Folder ancestry is bounded; this guards against corrupted parent cycles. */
export const MAX_FOLDER_DEPTH = 64;

export class AuthorizationService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /**
   * Strongest grant the user holds on `folderId` or any of its ancestors, or OWNER.
   * Inherited access is the maximum along the ancestor chain, so a VIEWER grant on a
   * grandparent reaches every descendant (and a deleted ancestor cuts off inheritance).
   */
  private async resolveFolderChainLevel(
    userId: string,
    startFolderId: string
  ): Promise<{ level: PermissionLevel | null; directPermission?: Permission }> {
    let level: PermissionLevel | null = null;
    let directPermission: Permission | undefined;
    let currentId: string | null = startFolderId;
    let hops = 0;

    while (currentId && hops < MAX_FOLDER_DEPTH) {
      const folder: Folder | null = await this.prismaClient.folder.findUnique({ where: { id: currentId } });
      if (!folder || folder.deletedAt) return { level: null };
      if (folder.ownerId === userId) return { level: 'OWNER' };

      const permission = await this.prismaClient.permission.findUnique({
        where: {
          resourceType_resourceId_granteeUserId: { resourceType: 'FOLDER', resourceId: currentId, granteeUserId: userId },
        },
      });
      if (permission) {
        if (hops === 0) directPermission = permission;
        level = strongerLevel(level, permission.level);
      }
      currentId = folder.parentFolderId;
      hops++;
    }

    return { level, directPermission };
  }

  async getFileAccess(userId: string, fileId: string): Promise<ResourceAccess> {
    const file = await this.prismaClient.file.findUnique({ where: { id: fileId } });

    if (!file || file.deletedAt) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    if (file.ownerId === userId) {
      return { file, effectiveLevel: 'OWNER', isOwner: true, isPublicAccess: false };
    }

    const permission = await this.prismaClient.permission.findUnique({
      where: {
        resourceType_resourceId_granteeUserId: { resourceType: 'FILE', resourceId: fileId, granteeUserId: userId },
      },
    });

    let level: PermissionLevel | null = permission?.level ?? null;
    if (file.folderId) {
      const inherited = await this.resolveFolderChainLevel(userId, file.folderId);
      level = strongerLevel(level, inherited.level);
    }

    if (!level) {
      // 404 rather than 403 so the existence of other users' files is not disclosed.
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    return { file, permission: permission ?? undefined, effectiveLevel: level, isOwner: false, isPublicAccess: false };
  }

  async getFolderAccess(userId: string, folderId: string): Promise<ResourceAccess> {
    const folder = await this.prismaClient.folder.findUnique({ where: { id: folderId } });

    if (!folder || folder.deletedAt) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    if (folder.ownerId === userId) {
      return { folder, effectiveLevel: 'OWNER', isOwner: true, isPublicAccess: false };
    }

    const { level, directPermission } = await this.resolveFolderChainLevel(userId, folderId);
    if (!level) {
      throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }

    return { folder, permission: directPermission, effectiveLevel: level, isOwner: false, isPublicAccess: false };
  }

  async authorizeFileAccess(context: AuthorizationContext, fileId: string, action: Action): Promise<ResourceAccess> {
    if (!context.isAuthenticated) {
      throw AppError.unauthorized('Authentication required', 'TOKEN_REQUIRED');
    }

    const access = await this.getFileAccess(context.userId, fileId);

    if (!hasPermission(access.effectiveLevel, action)) {
      throw AppError.forbidden(`Insufficient permissions to ${action} this file`, ErrorCodes.FORBIDDEN, {
        required: action,
        current: access.effectiveLevel,
      });
    }

    return access;
  }

  async authorizeFolderAccess(context: AuthorizationContext, folderId: string, action: Action): Promise<ResourceAccess> {
    if (!context.isAuthenticated) {
      throw AppError.unauthorized('Authentication required', 'TOKEN_REQUIRED');
    }

    const access = await this.getFolderAccess(context.userId, folderId);

    if (!hasPermission(access.effectiveLevel, action)) {
      throw AppError.forbidden(`Insufficient permissions to ${action} this folder`, ErrorCodes.FORBIDDEN, {
        required: action,
        current: access.effectiveLevel,
      });
    }

    return access;
  }

  async getEffectivePermissionLevel(
    userId: string,
    resourceType: ResourceType,
    resourceId: string
  ): Promise<PermissionLevel | null> {
    try {
      const access =
        resourceType === 'FILE'
          ? await this.getFileAccess(userId, resourceId)
          : await this.getFolderAccess(userId, resourceId);
      return access.effectiveLevel;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /**
   * IDs of every non-deleted file the user can currently read — owned, directly shared, or
   * inside a (transitively) shared folder — computed in a single database query. Used by AI
   * retrieval so that authorization is applied *inside* the vector search, never after it.
   * Optionally intersected with `restrictTo`.
   */
  async listAccessibleFileIds(userId: string, restrictTo?: string[]): Promise<string[]> {
    if (restrictTo && restrictTo.length === 0) return [];
    const rows = await this.prismaClient.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`${accessibleFilesCte(userId)}
        SELECT id FROM accessible_files
        ${restrictTo ? Prisma.sql`WHERE id IN (${Prisma.join(restrictTo)})` : Prisma.empty}`
    );
    return rows.map((r) => r.id);
  }
}

/**
 * SQL CTE defining `accessible_files(id)` for a user. Every hop excludes soft-deleted rows, so
 * deleting a folder immediately cuts off inherited access to its descendants.
 */
export function accessibleFilesCte(userId: string): Prisma.Sql {
  return Prisma.sql`
    WITH RECURSIVE granted_folders(id) AS (
      SELECT f."id" FROM "folders" f
        WHERE f."ownerId" = ${userId} AND f."deletedAt" IS NULL
      UNION
      SELECT f."id" FROM "permissions" p
        JOIN "folders" f ON f."id" = p."resourceId"
        WHERE p."granteeUserId" = ${userId} AND p."resourceType" = 'FOLDER'::"ResourceType" AND f."deletedAt" IS NULL
      UNION
      SELECT c."id" FROM "folders" c
        JOIN granted_folders g ON c."parentFolderId" = g.id
        WHERE c."deletedAt" IS NULL
    ),
    accessible_files(id) AS (
      SELECT fi."id" FROM "files" fi
        WHERE fi."ownerId" = ${userId} AND fi."deletedAt" IS NULL
      UNION
      SELECT fi."id" FROM "permissions" p
        JOIN "files" fi ON fi."id" = p."resourceId"
        WHERE p."granteeUserId" = ${userId} AND p."resourceType" = 'FILE'::"ResourceType" AND fi."deletedAt" IS NULL
      UNION
      SELECT fi."id" FROM "files" fi
        JOIN granted_folders g ON fi."folderId" = g.id
        WHERE fi."deletedAt" IS NULL
    )`;
}

export const authorizationService = new AuthorizationService();
