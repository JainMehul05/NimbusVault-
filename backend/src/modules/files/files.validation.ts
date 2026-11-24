import { z } from 'zod';
import { FileCategory } from '@prisma/client';
import { config } from '@config/index';
import { nameSchema } from '@common/names';
import { queryBoolean } from '@common/validation';

const fileIdParams = z.object({ fileId: z.string().uuid('Invalid file ID') });

export const fileUploadSchema = z.object({
  body: z.object({
    folderId: z.string().uuid('Invalid folder ID').optional().or(z.literal('')),
  }),
});

export const fileIdParamSchema = z.object({ params: fileIdParams });

export const fileRenameSchema = z.object({
  params: fileIdParams,
  body: z.object({ filename: nameSchema('Filename') }),
});

export const fileMoveSchema = z.object({
  params: fileIdParams,
  body: z.object({
    folderId: z.string().uuid('Invalid folder ID').nullable(),
  }),
});

export const fileListQuerySchema = z.object({
  query: z.object({
    // 'root' lists only files that are not inside any folder; omitting folderId lists all files.
    folderId: z.union([z.literal('root'), z.string().uuid('Invalid folder ID')]).optional(),
    category: z.nativeEnum(FileCategory).optional(),
    status: z.enum(['UPLOADING', 'READY', 'FAILED']).default('READY'),
    search: z.string().max(100, 'Search query too long').optional(),
    page: z.coerce.number().int().positive().max(100000).default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['filename', 'sizeBytes', 'uploadedAt', 'category']).default('uploadedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
});

export const fileDownloadSchema = z.object({
  params: fileIdParams,
  query: z.object({ inline: queryBoolean }),
});

export const filePresignedUploadSchema = z.object({
  body: z.object({
    filename: nameSchema('Filename'),
    contentType: z.string().min(1, 'Content type is required').max(255),
    // Required: quota is reserved for exactly this many bytes before a URL is issued.
    sizeBytes: z
      .number()
      .int()
      .positive('Empty file not allowed')
      .max(config.storage.maxFileBytes, 'File is too large'),
    folderId: z.string().uuid('Invalid folder ID').nullable().optional(),
    checksumSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'checksumSha256 must be 64 hexadecimal characters')
      .optional(),
  }),
});

export type FileUploadInput = z.infer<typeof fileUploadSchema>['body'];
export type FileListQuery = z.infer<typeof fileListQuerySchema>['query'];
export type FileDownloadQuery = z.infer<typeof fileDownloadSchema>['query'];
export type FilePresignedUploadInput = z.infer<typeof filePresignedUploadSchema>['body'];
