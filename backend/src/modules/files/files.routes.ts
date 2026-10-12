import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { filesController } from './files.controller';
import {
  fileUploadSchema,
  fileIdParamSchema,
  fileListQuerySchema,
  fileRenameSchema,
  fileMoveSchema,
  fileDownloadSchema,
  filePresignedUploadSchema,
} from './files.validation';
import multer from 'multer';
import path from 'path';
import os from 'os';

const router = Router();

// Configure multer for disk storage (avoids buffering large files in memory)
// Accept all file types at multer level; comprehensive validation happens in service
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (_req, _file, cb) => {
    // Accept all files at multer level; service will validate MIME type
    cb(null, true);
  },
});

// All file routes require authentication
router.use(authenticate);

// File upload
router.post(
  '/',
  upload.single('file'),
  (err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds maximum allowed limit (100MB)',
          error: { code: 'FILE_TOO_LARGE' },
          meta: { requestId: (req as any).requestId, timestamp: new Date().toISOString() },
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message,
        error: { code: 'UPLOAD_ERROR' },
        meta: { requestId: (req as any).requestId, timestamp: new Date().toISOString() },
      });
    }
    next(err);
  },
  validate(fileUploadSchema),
  filesController.upload
);

// List files
router.get(
  '/',
  validate(fileListQuerySchema),
  filesController.list
);

// Get storage info
router.get(
  '/storage/info',
  filesController.getStorageInfo
);

// Generate presigned upload URL
router.post(
  '/presigned-upload',
  validate(filePresignedUploadSchema),
  filesController.generatePresignedUploadUrl
);

// Get file metadata
router.get(
  '/:fileId',
  validate(fileIdParamSchema),
  filesController.getMetadata
);

// Download file (generate presigned URL)
router.get(
  '/:fileId/download',
  validate(fileDownloadSchema),
  filesController.download
);

// Rename file
router.patch(
  '/:fileId/rename',
  validate(fileRenameSchema),
  filesController.rename
);

// Move file
router.patch(
  '/:fileId/move',
  validate(fileMoveSchema),
  filesController.move
);

// Delete file (soft delete)
router.delete(
  '/:fileId',
  validate(fileIdParamSchema),
  filesController.delete
);

export default router;