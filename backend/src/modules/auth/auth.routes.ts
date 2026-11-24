import { Router } from 'express';
import { validate } from '@common/validation';
import { authController } from './auth.controller';
import { cookieCsrfGuard } from './auth.cookies';
import { authenticate } from './auth.middleware';
import { accountFailureLimiter, accountIpFailureLimiter, credentialLimiter, refreshLimiter } from './auth.limits';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  sessionIdSchema,
} from './auth.validation';

// Re-exported for the feature routers that import it from here.
export { authenticate } from './auth.middleware';

const router = Router();

// Auth responses carry credentials and must never be cached by browsers or intermediaries.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/register', credentialLimiter, validate(registerSchema), authController.register);
router.post(
  '/login',
  credentialLimiter,
  validate(loginSchema),
  accountIpFailureLimiter,
  accountFailureLimiter,
  authController.login
);
router.post('/refresh', refreshLimiter, validate(refreshSchema), cookieCsrfGuard, authController.refresh);
router.post('/logout', refreshLimiter, validate(logoutSchema), cookieCsrfGuard, authController.logout);
router.get('/me', authenticate, authController.me);

// Session management
router.get('/sessions', authenticate, authController.listSessions);
router.delete('/sessions', authenticate, authController.revokeOtherSessions);
router.delete('/sessions/:sessionId', authenticate, validate(sessionIdSchema), authController.revokeSession);
router.post('/change-password', credentialLimiter, authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;
