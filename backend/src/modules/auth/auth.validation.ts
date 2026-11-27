import { z } from 'zod';

/** Emails are case-insensitive: stored and compared in lower case. */
export const emailSchema = z
  .string()
  .trim()
  .max(254, 'Email is too long')
  .email('Invalid email format')
  .transform((v) => v.toLowerCase());

export const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  // bcrypt only reads the first 72 bytes; accepting more would silently ignore the rest.
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password too long (72 bytes maximum)')
  .refine((v) => /\p{L}/u.test(v) && /[^\p{L}]/u.test(v), 'Password must contain a letter and a number or symbol');

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
    email: emailSchema,
    password: newPasswordSchema,
    inviteCode: z.string().trim().max(128).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    // Upper bound only limits hashing cost; older accounts may have longer passwords than 72 bytes.
    password: z.string().min(1, 'Password is required').max(1024, 'Password too long'),
  }),
});

/** API clients send both values in the body; browsers send neither and rely on the cookie. */
export const refreshSchema = z.object({
  body: z
    .object({
      refreshToken: z.string().min(1, 'Refresh token is required').max(512).optional(),
      tokenFamily: z.string().uuid('Invalid token family').optional(),
    })
    .refine((b) => !!b.refreshToken === !!b.tokenFamily, 'refreshToken and tokenFamily must be sent together')
    .optional(),
});

export const logoutSchema = z.object({
  body: z.object({ tokenFamily: z.string().uuid('Invalid token family').optional() }).optional(),
});

export const sessionIdSchema = z.object({
  params: z.object({ sessionId: z.string().uuid('Invalid session ID') }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required').max(1024),
    newPassword: newPasswordSchema,
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RefreshInput = NonNullable<z.infer<typeof refreshSchema>['body']>;
export type LogoutInput = NonNullable<z.infer<typeof logoutSchema>['body']>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
