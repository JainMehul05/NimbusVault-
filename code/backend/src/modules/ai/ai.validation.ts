import { z } from 'zod';

const fileIdParams = z.object({ fileId: z.string().uuid('Invalid file ID') });
const fileIdList = z.array(z.string().uuid()).max(50).optional();

export const aiFileParamsSchema = z.object({ params: fileIdParams });

export const aiTextQuerySchema = z.object({
  params: fileIdParams,
  query: z.object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(20000).default(5000),
  }),
});

export const aiChunkParamsSchema = z.object({
  params: z.object({
    fileId: z.string().uuid('Invalid file ID'),
    chunkIndex: z.coerce.number().int().min(0).max(100000),
  }),
});

export const aiSearchSchema = z.object({
  body: z.object({
    query: z.string().trim().min(2, 'Query is too short').max(500, 'Query is too long'),
    limit: z.coerce.number().int().min(1).max(20).default(8),
    mode: z.enum(['filename','exact','semantic','hybrid','lexical']).default('hybrid'),
    folderId: z.string().uuid().optional(),
    category: z.enum(['pdf','document','image','video','other']).optional(),
    fileIds: fileIdList,
  }),
});

export const aiAskSchema = z.object({
  body: z.object({
    question: z.string().trim().min(3, 'Question is too short').max(1000, 'Question is too long'),
    fileIds: fileIdList,
    topK: z.coerce.number().int().min(1).max(12).default(8),
    conversationId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
  }),
});

export type AiSearchInput = z.infer<typeof aiSearchSchema>['body'];
export type AiAskInput = z.infer<typeof aiAskSchema>['body'];
export type AiTextQuery = z.infer<typeof aiTextQuerySchema>['query'];
