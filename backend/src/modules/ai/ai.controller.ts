import type { Request, Response, NextFunction } from 'express';
import type { DocumentIndex, File } from '@prisma/client';
import prisma from '@database/prisma';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError, ErrorCodes } from '@common/errors';
import { authorizationService, hasPermission, type PermissionLevel } from '@common/authorization';
import { activityLogService } from '@modules/activity/activity.service';
import { getAiStatus } from './ai.status';
import { aiIndexingService } from './indexing.service';
import { summaryService } from './summary.service';
import { ragService } from './rag.service';
import { isAiSupportedMimeType } from './extraction';
import type { AiAskInput, AiSearchInput, AiTextQuery } from './ai.validation';

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string; type: string };
}

/** Friendly lifecycle name for the API/UI. */
export const aiStatusLabel = (status: File['aiStatus']) =>
  ({ NA: 'not_indexed', PENDING: 'pending', PROCESSING: 'processing', INDEXED: 'ready', FAILED: 'failed', UNSUPPORTED: 'unsupported' })[
    status
  ];

async function readableFile(userId: string, fileId: string) {
  // Access is re-evaluated on every request, so revoked shares lose AI access immediately.
  const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'read');
  return { file: access.file!, level: access.effectiveLevel as PermissionLevel };
}

function serializeIndex(file: File, index: DocumentIndex | null, level: PermissionLevel) {
  return {
    fileId: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    status: aiStatusLabel(file.aiStatus),
    supported: isAiSupportedMimeType(file.mimeType),
    canReindex: hasPermission(level, 'write'),
    error: index?.errorCode ? { code: index.errorCode, message: index.errorMessage } : null,
    extraction: index?.textLength
      ? {
          extractor: index.extractor,
          characters: index.textLength,
          truncated: index.textTruncated,
          pageCount: index.pageCount,
        }
      : null,
    chunkCount: index?.chunkCount ?? 0,
    embeddingModel: index?.embeddingModel ?? null,
    indexedAt: index?.indexedAt ?? null,
    summary: {
      status: (index?.summaryStatus ?? 'NONE').toLowerCase(),
      text: index?.summaryStatus === 'READY' ? index.summary : null,
      model: index?.summaryModel ?? null,
      coverage: index?.summaryCoverage ?? null,
      generatedAt: index?.summaryGeneratedAt ?? null,
      error: index?.summaryStatus === 'FAILED' || index?.summaryStatus === 'UNAVAILABLE' ? index.summaryError : null,
    },
  };
}

export const aiController = {
  status: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    res.json(successResponse(getAiStatus(), 'AI status', req.requestId));
  }),

  getFile: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { file, level } = await readableFile(req.user!.userId, req.params.fileId);
    const [index, job] = await Promise.all([
      prisma.documentIndex.findUnique({ where: { fileId: file.id } }),
      prisma.aiJob.findFirst({ where: { fileId: file.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json(
      successResponse(
        {
          ...serializeIndex(file, index, level),
          job: job
            ? {
                status: job.status.toLowerCase(),
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                nextAttemptAt: job.status === 'QUEUED' ? job.runAfter : null,
                lastError: job.lastError,
              }
            : null,
        },
        'AI document status',
        req.requestId
      )
    );
  }),

  reindex: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    // Re-indexing spends compute/provider budget: owners and editors only.
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, req.params.fileId, 'write');
    const result = await aiIndexingService.enqueue(access.file!.id);
    await activityLogService.logActivity(userId, 'ai_reindex', {
      resourceType: 'FILE',
      resourceId: access.file!.id,
      targetOwnerId: access.file!.ownerId,
      metadata: { filename: access.file!.filename },
      requestId: req.requestId,
    });
    res.status(202).json(successResponse({ fileId: access.file!.id, status: 'pending', jobId: result.jobId }, 'Indexing queued', req.requestId));
  }),

  getText: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { file } = await readableFile(req.user!.userId, req.params.fileId);
    const { offset, limit } = req.query as unknown as AiTextQuery;
    const index = await prisma.documentIndex.findUnique({ where: { fileId: file.id } });
    if (file.aiStatus !== 'INDEXED' || !index?.textContent) {
      throw AppError.notFound('No extracted text is available for this file', ErrorCodes.AI_NOT_INDEXED);
    }
    const text = index.textContent.slice(offset, offset + limit);
    res.json(
      successResponse(
        { fileId: file.id, offset, length: text.length, totalLength: index.textContent.length, truncatedAtExtraction: index.textTruncated, text },
        'Extracted text',
        req.requestId
      )
    );
  }),

  getChunk: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { file } = await readableFile(req.user!.userId, req.params.fileId);
    const chunkIndex = Number(req.params.chunkIndex);
    const index = await prisma.documentIndex.findUnique({ where: { fileId: file.id }, select: { generation: true } });
    const chunk = index
      ? await prisma.documentChunk.findFirst({
          where: { fileId: file.id, generation: index.generation, chunkIndex },
          select: { chunkIndex: true, content: true, pageStart: true, pageEnd: true, charStart: true, charEnd: true },
        })
      : null;
    if (file.aiStatus !== 'INDEXED' || !chunk) {
      throw AppError.notFound('Passage not found', ErrorCodes.AI_NOT_INDEXED);
    }
    res.json(successResponse({ fileId: file.id, filename: file.filename, ...chunk }, 'Passage', req.requestId));
  }),

  summarize: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, req.params.fileId, 'write');
    await summaryService.generate(access.file!.id);
    const index = await prisma.documentIndex.findUnique({ where: { fileId: access.file!.id } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: access.file!.id } });
    res.json(successResponse(serializeIndex(file, index, access.effectiveLevel).summary, 'Summary generated', req.requestId));
  }),

  search: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { query, limit, fileIds } = req.body as AiSearchInput;
    const result = await ragService.search(req.user!.userId, query, { limit, fileIds });
    res.json(successResponse(result, 'Search results', req.requestId));
  }),

  ask: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { question, fileIds, topK } = req.body as AiAskInput;
    const result = await ragService.ask(userId, question, { fileIds, topK });
    // The question text itself is not stored in the audit log.
    await activityLogService.logActivity(userId, 'ai_query', {
      resourceType: 'USER',
      resourceId: userId,
      targetOwnerId: userId,
      metadata: { questionChars: question.length, status: result.status, citations: result.citations.length },
      requestId: req.requestId,
    });
    res.json(successResponse(result, 'Answer', req.requestId));
  }),
};
