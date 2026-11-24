import type { NextFunction, Request, Response } from 'express';
import { unlink } from 'fs/promises';

/** Deletes multer's temp file once the response ends, whether it succeeded, failed or was aborted. */
export function removeTempUpload(req: Request, res: Response, next: NextFunction): void {
  res.once('close', () => {
    if (req.file?.path) void unlink(req.file.path).catch(() => {});
  });
  next();
}
