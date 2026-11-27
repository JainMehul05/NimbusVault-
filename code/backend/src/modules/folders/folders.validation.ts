import { z } from 'zod';
import { nameSchema } from '@common/names';
import { queryBoolean } from '@common/validation';

export const folderCreateSchema = z.object({
  body: z.object({
    name: nameSchema('Folder name'),
    parentFolderId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
  }),
});

export const folderIdParamSchema = z.object({
  params: z.object({
    folderId: z.string().refine((val) => val === 'root' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val), {
      message: 'Invalid folder ID',
    }),
  }),
});

export const folderTreeSchema = z.object({
  params: z.object({
    folderId: z.union([z.literal('root'), z.string().uuid('Invalid folder ID')]).optional(),
  }),
});

export const folderDeleteSchema = z.object({
  params: z.object({ folderId: z.string().uuid('Invalid folder ID') }),
  query: z.object({ deleteDescendants: queryBoolean }),
});

export const folderRenameSchema = z.object({
  params: z.object({
    folderId: z.string().uuid('Invalid folder ID'),
  }),
  body: z.object({ name: nameSchema('Folder name') }),
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
    page: z.coerce.number().int().positive().max(100000).default(1),
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