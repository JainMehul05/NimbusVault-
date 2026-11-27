import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '@modules/auth/auth.middleware';
import { successResponse } from '@common/response';
import type { AccessTokenPayload } from '@modules/auth/jwt.utils';
import prisma from '@database/prisma';
import { asyncHandler } from '@common/async-handler';
import { AppError } from '@common/errors';

const router = Router();

router.get('/profile', authenticate, (req: Request & { user?: AccessTokenPayload }, res: Response) => {
  const { userId, email } = req.user!;
  res.json(successResponse({ userId, email, type: 'access' }, 'User profile', req.requestId));
});

/** External AI (Groq) consent: covers this user's questions and the documents they own. */
router.get('/me/ai-preferences', authenticate, asyncHandler(async (req: Request & { user?: AccessTokenPayload }, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { externalAiConsent: true } });
  res.json(successResponse({ externalAiConsent: Boolean(user?.externalAiConsent) }, 'AI preferences', req.requestId));
}));

router.put('/me/ai-preferences', authenticate, asyncHandler(async (req: Request & { user?: AccessTokenPayload }, res: Response) => {
  const value = (req.body as { externalAiConsent?: unknown })?.externalAiConsent;
  if (typeof value !== 'boolean') throw AppError.badRequest('externalAiConsent must be true or false');
  await prisma.user.update({ where: { id: req.user!.userId }, data: { externalAiConsent: value } });
  res.json(successResponse({ externalAiConsent: value }, 'AI preferences updated', req.requestId));
}));

export default router;
