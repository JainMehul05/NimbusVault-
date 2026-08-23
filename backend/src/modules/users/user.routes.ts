import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '@modules/auth/auth.routes';

const router = Router();

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
}

router.get('/profile', authenticate, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    message: 'User profile',
    data: req.user,
  });
});

export default router;