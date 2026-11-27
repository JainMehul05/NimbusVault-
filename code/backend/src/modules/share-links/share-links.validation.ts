import { z } from 'zod';

export const sharePermissionSchema = z.enum(['VIEW', 'DOWNLOAD']);

export const createShareLinkSchema = z.object({
  body: z.object({
    fileId: z.string().uuid(),
    permission: sharePermissionSchema.default('VIEW'),
    // bcrypt reads at most 72 bytes.
    password: z
      .string()
      .min(4, 'Password must be at least 4 characters')
      .max(72, 'Password too long')
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password too long')
      .optional(),
    expiresAt: z
      .string()
      .datetime()
      .refine((v) => new Date(v).getTime() > Date.now(), 'Expiry must be in the future')
      .optional(),
    maxDownloads: z.coerce.number().int().positive().max(1_000_000).optional(),
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
    token: z.string().min(1).max(100),
  }),
});