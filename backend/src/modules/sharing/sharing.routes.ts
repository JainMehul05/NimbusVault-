import { Router } from 'express';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { sharingController } from './sharing.controller';
import {
  createShareSchema,
  updateShareSchema,
  revokeShareSchema,
  listSharesSchema,
  sharedWithMeSchema,
  sharedByMeSchema,
} from './sharing.validation';

const router = Router();

// All sharing routes require authentication
router.use(authenticate);

// Create or update a share
router.post(
  '/',
  validate(createShareSchema),
  sharingController.createShare
);

// List shares for a resource (owner only)
router.get(
  '/:resourceType/:resourceId',
  validate(listSharesSchema),
  sharingController.listShares
);

// Update a share permission
router.patch(
  '/:resourceType/:resourceId/:granteeId',
  validate(updateShareSchema),
  sharingController.updateShare
);

// Revoke a share
router.delete(
  '/:resourceType/:resourceId/:granteeId',
  validate(revokeShareSchema),
  sharingController.revokeShare
);

// Get resources shared with me
router.get(
  '/me/shared-with-me',
  validate(sharedWithMeSchema),
  sharingController.getSharedWithMe
);

// Get resources shared by me
router.get(
  '/me/shared-by-me',
  validate(sharedByMeSchema),
  sharingController.getSharedByMe
);

export default router;