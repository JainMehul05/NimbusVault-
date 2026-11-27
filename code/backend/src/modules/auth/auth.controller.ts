import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError, ErrorCodes } from '@common/errors';
import { authService, type AuthResult, type RequestMeta } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie, wantsCookieTransport } from './auth.cookies';
import type { RegisterInput, LoginInput, RefreshInput, LogoutInput, ChangePasswordInput } from './auth.validation';
import type { AccessTokenPayload } from './jwt.utils';

interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

const metaOf = (req: Request): RequestMeta => ({
  ipAddress: req.ip,
  requestId: req.requestId,
  userAgent: req.get('user-agent'),
});

/** Cookie clients receive only the access token; API clients also get the refresh token. */
const authBody = (req: Request, result: AuthResult) =>
  wantsCookieTransport(req)
    ? { user: result.user, tokens: { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn } }
    : result;

export const authController = {
  register: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const result = await authService.register(req.body as RegisterInput, metaOf(req));
    setRefreshCookie(res, result.tokens);
    res.status(201).json(successResponse(authBody(req, result), 'Registration successful', req.requestId));
  }),

  login: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const result = await authService.login(req.body as LoginInput, metaOf(req));
    setRefreshCookie(res, result.tokens);
    res.json(successResponse(authBody(req, result), 'Login successful', req.requestId));
  }),

  refresh: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const body = (req.body ?? {}) as RefreshInput;
    const fromBody =
      body.refreshToken && body.tokenFamily ? { refreshToken: body.refreshToken, tokenFamily: body.tokenFamily } : null;
    const credentials = fromBody ?? readRefreshCookie(req);
    if (!credentials) {
      throw AppError.unauthorized('Refresh token required', ErrorCodes.INVALID_REFRESH_TOKEN);
    }

    let tokens;
    try {
      tokens = await authService.refresh(credentials.refreshToken, credentials.tokenFamily, metaOf(req));
    } catch (error) {
      // A dead cookie would otherwise be resent forever. It is kept on a benign race (409).
      if (!fromBody && error instanceof AppError && error.statusCode === 401) clearRefreshCookie(res);
      throw error;
    }

    setRefreshCookie(res, tokens);
    // A cookie-authenticated refresh never reveals the new token to script.
    const payload = fromBody ? tokens : { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
    res.json(successResponse(payload, 'Token refreshed', req.requestId));
  }),

  logout: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { tokenFamily } = (req.body ?? {}) as LogoutInput;
    const cookie = readRefreshCookie(req);
    if (tokenFamily) await authService.logout(tokenFamily, metaOf(req));
    else if (cookie) await authService.logoutByRefreshToken(cookie.refreshToken, cookie.tokenFamily, metaOf(req));

    clearRefreshCookie(res);
    res.json(successResponse(null, 'Logged out successfully', req.requestId));
  }),

  me: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const user = await authService.me(req.user!.userId);
    res.json(successResponse(user, 'User profile retrieved', req.requestId));
  }),

  listSessions: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const sessions = await authService.listSessions(req.user!.userId, req.user!.sid);
    res.json(successResponse({ sessions }, 'Active sessions', req.requestId));
  }),

  revokeSession: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    await authService.revokeSession(req.user!.userId, req.params.sessionId, metaOf(req));
    res.json(successResponse(null, 'Session signed out', req.requestId));
  }),

  revokeOtherSessions: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const count = await authService.revokeOtherSessions(req.user!.userId, req.user!.sid, metaOf(req));
    res.json(successResponse({ revoked: count }, 'Other sessions signed out', req.requestId));
  }),

  changePassword: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;
    await authService.changePassword(req.user!.userId, req.user!.sid, currentPassword, newPassword, metaOf(req));
    res.json(successResponse(null, 'Password changed', req.requestId));
  }),
};
