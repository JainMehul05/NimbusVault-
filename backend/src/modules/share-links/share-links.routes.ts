import { Router } from 'express';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { shareLinkController } from './share-links.controller';
import {
  createShareLinkSchema,
  listShareLinksSchema,
  revokeShareLinkSchema,
  accessShareLinkSchema,
} from './share-links.validation';

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
// Access a shared resource via token
router.get(
  '/public/:token',
  validate(accessShareLinkSchema),
  shareLinkController.accessShareLink
);

// Download via share link
router.get(
  '/public/:token/download',
  validate(accessShareLinkSchema),
  shareLinkController.downloadShareLink
);

export default router;