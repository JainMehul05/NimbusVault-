import { Router } from 'express';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { foldersController } from './folders.controller';
import {
  folderCreateSchema,
  folderIdParamSchema,
  folderRenameSchema,
  folderMoveSchema,
  folderListQuerySchema,
  folderTreeSchema,
  folderDeleteSchema,
} from './folders.validation';

const router = Router();

// All folder routes require authentication
router.use(authenticate);

// Create folder
router.post(
  '/',
  validate(folderCreateSchema),
  foldersController.create
);

// List folders (with pagination)
router.get(
  '/',
  validate(folderListQuerySchema),
  foldersController.list
);

// Get folder tree
router.get(
  '/tree/:folderId?',
  validate(folderTreeSchema),
  foldersController.getTree
);

// Get folder contents (folders + files)
router.get(
  '/:folderId/contents',
  validate(folderIdParamSchema),
  foldersController.getContents
);

// Rename folder
router.patch(
  '/:folderId/rename',
  validate(folderRenameSchema),
  foldersController.rename
);

// Move folder
router.patch(
  '/:folderId/move',
  validate(folderMoveSchema),
  foldersController.move
);

// Delete folder (moves to trash)
router.delete(
  '/:folderId',
  validate(folderDeleteSchema),
  foldersController.delete
);

export default router;