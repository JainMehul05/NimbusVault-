import { Router } from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { errorResponse } from '@common/response';
import { config } from '@config/index';
import { aiController } from './ai.controller';
import { aiAskSchema, aiChunkParamsSchema, aiFileParamsSchema, aiSearchSchema, aiTextQuerySchema } from './ai.validation';

const router = Router();

// Every AI endpoint requires an authenticated account; share-link tokens never grant AI access.
router.use(authenticate);

/** Per-user budget for model-backed endpoints (cost-amplification protection). */
const perUser = (max: number) =>
  rateLimit({
    windowMs: config.ai.limits.queryWindowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `ai:${(req as Request & { user?: { userId: string } }).user?.userId ?? req.ip}`,
    message: errorResponse('AI request limit reached. Please wait a few minutes.', 'RATE_LIMIT_EXCEEDED'),
  });

const queryLimiter = perUser(config.ai.limits.queriesPerWindow);
const searchLimiter = perUser(config.ai.limits.queriesPerWindow * 3);

router.get('/status', aiController.status);
router.post('/search', searchLimiter, validate(aiSearchSchema), aiController.search);
router.post('/ask', queryLimiter, validate(aiAskSchema), aiController.ask);
router.get('/files/:fileId', validate(aiFileParamsSchema), aiController.getFile);
router.post('/files/:fileId/index', queryLimiter, validate(aiFileParamsSchema), aiController.reindex);
router.get('/files/:fileId/text', validate(aiTextQuerySchema), aiController.getText);
router.get('/files/:fileId/chunks/:chunkIndex', validate(aiChunkParamsSchema), aiController.getChunk);
router.post('/files/:fileId/summary', queryLimiter, validate(aiFileParamsSchema), aiController.summarize);

export default router;
