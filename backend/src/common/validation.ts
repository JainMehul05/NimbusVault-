import type { Request, Response, NextFunction } from 'express';
import type { AnyZodObject } from 'zod';
import { ZodError } from 'zod';

export const validate =
  (schema: AnyZodObject) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      // Apply transformed values back to request (only for defined schema fields)
      if ('body' in parsed) req.body = parsed.body;
      if ('query' in parsed) req.query = parsed.query;
      if ('params' in parsed) req.params = parsed.params;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          error: { code: 'VALIDATION_ERROR', details },
          meta: { requestId: req.requestId || 'unknown', timestamp: new Date().toISOString() },
        });
      }
      return next(error);
    }
  };