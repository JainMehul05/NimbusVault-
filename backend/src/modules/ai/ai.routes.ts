import { Router } from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '@modules/auth/auth.routes';
import { validate } from '@common/validation';
import { errorResponse } from '@common/response';
import { config } from '@config/index';
import { intelligence } from '@common/intelligence';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { activeRequests, allowedScope, localHistory } from './local-intelligence';
import prisma from '@database/prisma';
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

router.post('/cancel', queryLimiter, asyncHandler(async (req, res) => {
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  const requestId=String(req.body.requestId||'');
  if(activeRequests.get(requestId)!==userId) throw AppError.notFound('Active request not found');
  res.json(successResponse(await intelligence('/api/ai/cancel',{request_id:requestId},userId),'Cancellation requested',req.requestId));
}));
router.get('/conversations',asyncHandler(async(req,res)=>{
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  res.json(successResponse(await intelligence('/api/ai/conversations',undefined,userId,await allowedScope(userId)),'History',req.requestId));
}));
router.get('/conversations/:id',asyncHandler(async(req,res)=>{
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  if(!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw AppError.notFound('Conversation missing');
  res.json(successResponse(await localHistory(userId,req.params.id),'Conversation',req.requestId));
}));
router.get('/cloud',asyncHandler(async(req,res)=>{
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(user?.role!=='admin') throw AppError.forbidden('Infrastructure diagnostics require a designated administrator');
  res.json(successResponse(await intelligence('/cloud/status'),'Cloud status',req.requestId));
}));
router.post('/cloud/complete',queryLimiter,asyncHandler(async(req,res)=>{
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(user?.role!=='admin') throw AppError.forbidden('Administrator required');
  const fileId=String(req.body.fileId||'');
  if(!(await allowedScope(userId,[fileId])).includes(fileId)) throw AppError.notFound('Indexed file missing');
  res.json(successResponse(await intelligence('/cloud/complete',{file_id:fileId}),'Bounded reconciliation',req.requestId));
}));
router.post('/cloud/probe',queryLimiter,asyncHandler(async(req,res)=>{
  const userId=(req as Request & {user:{userId:string}}).user.userId;
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(user?.role!=='admin') throw AppError.forbidden('Administrator required');
  res.json(successResponse(await intelligence('/cloud/probe',{}),'Bounded live probe',req.requestId));
}));

router.get('/status', aiController.status);
router.post('/search', searchLimiter, validate(aiSearchSchema), aiController.search);
router.post('/ask', queryLimiter, validate(aiAskSchema), aiController.ask);
router.get('/files/:fileId', validate(aiFileParamsSchema), aiController.getFile);
router.post('/files/:fileId/index', queryLimiter, validate(aiFileParamsSchema), aiController.reindex);
router.get('/files/:fileId/text', validate(aiTextQuerySchema), aiController.getText);
router.get('/files/:fileId/chunks/:chunkIndex', validate(aiChunkParamsSchema), aiController.getChunk);
router.post('/files/:fileId/summary', queryLimiter, validate(aiFileParamsSchema), aiController.summarize);

export default router;
