import { Router } from 'express';
import { authenticate } from '@modules/auth/auth.middleware';
import { validate } from '@common/validation';
import { config } from '@config/index';
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
import os from 'os';
import { randomUUID } from 'crypto';
import { removeTempUpload } from './temp-upload';

const router = Router();

// Disk storage avoids buffering large files in memory. The temp name is random and never derived
// from the client's filename; content and type are validated in the controller.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `nv-upload-${randomUUID()}`),
  }),
  limits: {
    fileSize: config.storage.maxFileBytes,
    files: 1,
    fields: 5,
    fieldSize: 1024,
  },
  defParamCharset: 'utf8',
});

// All file routes require authentication
router.use(authenticate);

// File upload. removeTempUpload guarantees the temp file is deleted however the request ends.
router.post('/', removeTempUpload, upload.single('file'), validate(fileUploadSchema), filesController.upload);

// List files
router.get('/', validate(fileListQuerySchema), filesController.list);

// Get storage info
router.get('/storage/info', filesController.getStorageInfo);
router.get('/statistics',filesController.statistics);

// Presigned uploads: begin → PUT to storage → complete (or abort)
router.post('/presigned-upload', validate(filePresignedUploadSchema), filesController.beginPresignedUpload);
router.post('/:fileId/complete', validate(fileIdParamSchema), filesController.completePresignedUpload);
router.delete('/:fileId/upload', validate(fileIdParamSchema), filesController.abortPresignedUpload);

// Get file metadata
router.get('/:fileId', validate(fileIdParamSchema), filesController.getMetadata);

// Download file (generate presigned URL)
router.get('/:fileId/download', validate(fileDownloadSchema), filesController.download);

// Rename file
router.patch('/:fileId/rename', validate(fileRenameSchema), filesController.rename);

// Move file
router.patch('/:fileId/move', validate(fileMoveSchema), filesController.move);

// Delete file (moves to trash)
router.delete('/:fileId', validate(fileIdParamSchema), filesController.delete);

export default router;
