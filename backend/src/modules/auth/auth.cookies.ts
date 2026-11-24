import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { AppError } from '@common/errors';
import { config } from '@config/index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: config.session.cookieSecure,
  sameSite: config.session.cookieSameSite,
  // Only the auth endpoints ever receive the cookie.
  path: `/api/${config.apiPrefix}/auth`,
});

export function setRefreshCookie(
  res: Response,
  tokens: { refreshToken: string; refreshTokenFamily: string; expiresIn: number }
): void {
  res.cookie(config.session.cookieName, `${tokens.refreshTokenFamily}.${tokens.refreshToken}`, {
    ...baseOptions(),
    maxAge: tokens.expiresIn * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.session.cookieName, baseOptions());
}

export function readRefreshCookie(req: Request): { refreshToken: string; tokenFamily: string } | null {
  const raw: unknown = req.cookies?.[config.session.cookieName];
  if (typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot === -1) return null;
  const tokenFamily = raw.slice(0, dot);
  const refreshToken = raw.slice(dot + 1);
  const valid = UUID.test(tokenFamily) && refreshToken.length > 0 && refreshToken.length <= 512;
  return valid ? { refreshToken, tokenFamily } : null;
}

/** Browser clients opt in to cookie transport; their response bodies never carry the refresh token. */
export const wantsCookieTransport = (req: Request): boolean => req.get('x-auth-transport') === 'cookie';

/**
 * CSRF defence for endpoints authenticated by the cookie alone. A cross-site form or image
 * cannot set a custom header, and a cross-origin script can only do so after a CORS preflight
 * that we answer for our own origins. Origin is checked as well when the browser sends it.
 * Requests that carry the token in the body are not cookie-authenticated and need no check.
 */
export function cookieCsrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.body?.refreshToken || req.body?.tokenFamily) return next();
  if (!req.cookies?.[config.session.cookieName]) return next();
  const origin = req.get('origin');
  if (req.get('x-requested-with') !== 'XMLHttpRequest' || (origin && !config.frontend.origins.includes(origin))) {
    return next(AppError.forbidden('Cross-site request rejected', 'CSRF_REJECTED'));
  }
  next();
}
