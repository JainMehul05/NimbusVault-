import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { AppError } from '@common/errors';
import { verifyAccessToken, type AccessTokenPayload } from './jwt.utils';
import { tokenService } from './token.service';

interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

/** Requires a valid access token whose session has not been revoked. */
export const authenticate = asyncHandler(async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Access token required', 'TOKEN_REQUIRED');
  }

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw AppError.unauthorized('Invalid or expired token', 'INVALID_TOKEN');
  }

  if (!(await tokenService.isSessionActive(payload.sid, payload.userId))) {
    throw AppError.unauthorized('Session has ended', 'SESSION_REVOKED');
  }

  req.user = payload;
  next();
});
