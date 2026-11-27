import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validate =
  (schema: z.ZodObject) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      })) as { body?: unknown; query?: Request['query']; params?: Request['params'] };
      // Apply transformed values back to request (only for defined schema fields)
      if ('body' in parsed) req.body = parsed.body;
      if ('query' in parsed) req.query = parsed.query!;
      if ('params' in parsed) req.params = parsed.params!;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((e) => ({
          field: e.path.map(String).join('.'),
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

/** `true`/`1` → true, everything else → false (z.coerce.boolean treats the string "false" as true). */
export const queryBoolean = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');
