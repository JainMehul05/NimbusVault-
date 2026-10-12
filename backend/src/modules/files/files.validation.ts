import { z } from 'zod';
import { FileCategory } from '@prisma/client';

export const fileUploadSchema = z.object({
  body: z.object({
    folderId: z.string().uuid('Invalid folder ID').optional().or(z.literal('')),
  }),
});

export const fileIdParamSchema = z.object({
  params: z.object({
    fileId: z.string().min(1, 'File ID is required'),
  }),
});

export const fileRenameSchema = z.object({
  params: z.object({
    fileId: z.string().uuid('Invalid file ID'),
  }),
  body: z.object({
    filename: z.string().min(1, 'Filename is required').max(255, 'Filename too long'),
  }),
});

export const fileMoveSchema = z.object({
  params: z.object({
    fileId: z.string().uuid('Invalid file ID'),
  }),
  body: z.object({
    folderId: z.string().uuid('Invalid folder ID').nullable(),
  }),
});

export const fileListQuerySchema = z.object({
  query: z.object({
    folderId: z.string().uuid('Invalid folder ID').optional(),
    category: z.nativeEnum(FileCategory).optional(),
    status: z.enum(['UPLOADING', 'READY', 'FAILED']).optional(),
    search: z.string().max(100, 'Search query too long').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['filename', 'sizeBytes', 'uploadedAt', 'category']).default('uploadedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
});

export const fileDownloadSchema = z.object({
  params: z.object({
    fileId: z.string().uuid('Invalid file ID'),
  }),
  query: z.object({
    inline: z.coerce.boolean().default(false),
  }),
});

export const filePresignedUploadSchema = z.object({
  body: z.object({
    filename: z.string().min(1, 'Filename is required').max(255, 'Filename too long'),
    contentType: z.string().min(1, 'Content type is required'),
  }),
});

export type FileUploadInput = z.infer<typeof fileUploadSchema>['body'];
export type FileIdParam = z.infer<typeof fileIdParamSchema>['params'];
export type FileRenameInput = z.infer<typeof fileRenameSchema>['body'];
export type FileMoveInput = z.infer<typeof fileMoveSchema>['body'];
export type FileListQuery = z.infer<typeof fileListQuerySchema>['query'];
export type FileDownloadQuery = z.infer<typeof fileDownloadSchema>['query'];
export type FilePresignedUploadInput = z.infer<typeof filePresignedUploadSchema>['body'];