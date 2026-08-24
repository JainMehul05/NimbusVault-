import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '@common/validation';
import { asyncHandler } from '@common/async-handler';
import { authController } from './auth.controller';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './auth.validation';
import { verifyAccessToken } from './jwt.utils';
import { AppError } from '@common/errors';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
}

const router = Router();

export const authenticate = asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw AppError.unauthorized('Access token required', 'TOKEN_REQUIRED');
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired token', 'INVALID_TOKEN');
  }
});

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', validate(logoutSchema), authController.logout);
router.get('/me', authenticate, authController.me);

export default router;