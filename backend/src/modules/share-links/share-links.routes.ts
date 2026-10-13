import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { shareLinkController } from './share-links.controller';
import {
  createShareLinkSchema,
  listShareLinksSchema,
  revokeShareLinkSchema,
  accessShareLinkSchema,
} from './share-links.validation';
import { errorResponse } from '@common/response';

const router = Router();

// Protected routes - require authentication
router.use('/protected', authenticate);

// Create a share link
router.post(
  '/protected',
  validate(createShareLinkSchema),
  shareLinkController.createShareLink
);

// List share links for a file
router.get(
  '/protected/:fileId',
  validate(listShareLinksSchema),
  shareLinkController.listShareLinks
);

// Revoke a share link
router.delete(
  '/protected/:shareLinkId',
  validate(revokeShareLinkSchema),
  shareLinkController.revokeShareLink
);

// Public routes - no authentication required
// Rate limiter for public share-link access (prevent brute-force)
const shareLinkRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window per IP
  message: errorResponse('Too many requests to share link', 'RATE_LIMIT_EXCEEDED'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `share-link:${req.params.token}:${req.ip}`,
});

// Access a shared resource via token
router.get(
  '/public/:token',
  shareLinkRateLimiter,
  validate(accessShareLinkSchema),
  shareLinkController.accessShareLink
);

// Download via share link
router.get(
  '/public/:token/download',
  shareLinkRateLimiter,
  validate(accessShareLinkSchema),
  shareLinkController.downloadShareLink
);

export default router;