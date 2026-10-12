import { Router } from 'express';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { activityController } from './activity.controller';
import { activityLogQuerySchema, resourceActivitySchema } from './activity.validation';

const router = Router();

// All activity routes require authentication
router.use(authenticate);

// Get activity log (with filters)
router.get(
  '/',
  validate(activityLogQuerySchema),
  activityController.getActivityLog
);

// Get current user's activity
router.get(
  '/me',
  activityController.getMyActivity
);

// Get activity for a specific resource
router.get(
  '/resource/:resourceType/:resourceId',
  validate(resourceActivitySchema),
  activityController.getResourceActivity
);

export default router;