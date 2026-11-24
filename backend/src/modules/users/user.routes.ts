import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '@modules/auth/auth.middleware';
import { successResponse } from '@common/response';
import type { AccessTokenPayload } from '@modules/auth/jwt.utils';

const router = Router();

router.get('/profile', authenticate, (req: Request & { user?: AccessTokenPayload }, res: Response) => {
  const { userId, email } = req.user!;
  res.json(successResponse({ userId, email, type: 'access' }, 'User profile', req.requestId));
});

export default router;
