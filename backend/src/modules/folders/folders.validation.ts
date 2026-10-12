import { z } from 'zod';

export const folderCreateSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Folder name is required').max(255, 'Folder name too long'),
    parentFolderId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
  }),
});

export const folderIdParamSchema = z.object({
  params: z.object({
    folderId: z.string().refine((val) => val === 'root' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
      message: 'Invalid folder ID',
    }),
  }),
});



export const folderRenameSchema = z.object({
  params: z.object({
    folderId: z.string().uuid('Invalid folder ID'),
  }),
  body: z.object({
    name: z.string().min(1, 'Folder name is required').max(255, 'Folder name too long'),
  }),
});

export const folderMoveSchema = z.object({
  params: z.object({
    folderId: z.string().uuid('Invalid folder ID'),
  }),
  body: z.object({
    parentFolderId: z.string().uuid('Invalid parent folder ID').nullable(),
  }),
});

export const folderListQuerySchema = z.object({
  query: z.object({
    parentFolderId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['name', 'createdAt', 'depth']).default('name'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),
});

export type FolderCreateInput = z.infer<typeof folderCreateSchema>['body'];
export type FolderIdParam = z.infer<typeof folderIdParamSchema>['params'];
export type FolderRenameInput = z.infer<typeof folderRenameSchema>['body'];
export type FolderMoveInput = z.infer<typeof folderMoveSchema>['body'];
export type FolderListQuery = z.infer<typeof folderListQuerySchema>['query'];