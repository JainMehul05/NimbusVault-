import { z } from 'zod';

export const sharePermissionSchema = z.enum(['VIEW', 'DOWNLOAD']);

export const createShareLinkSchema = z.object({
  body: z.object({
    fileId: z.string().uuid(),
    permission: sharePermissionSchema.default('VIEW'),
    password: z.string().min(4).max(100).optional(),
    expiresAt: z.string().datetime().optional(),
    maxDownloads: z.coerce.number().int().positive().optional(),
  }),
});

export const listShareLinksSchema = z.object({
  params: z.object({
    fileId: z.string().uuid(),
  }),
});

export const revokeShareLinkSchema = z.object({
  params: z.object({
    shareLinkId: z.string().uuid(),
  }),
});

export const accessShareLinkSchema = z.object({
  params: z.object({
    token: z.string().min(1),
  }),
  query: z.object({
    password: z.string().optional(),
  }),
});