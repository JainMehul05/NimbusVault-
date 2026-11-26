import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { config } from '@config/index';
import { errorResponse, successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { createRequestLogger } from '@common/logger';
import authRoutes from '@modules/auth/auth.routes';
import userRoutes from '@modules/users/user.routes';
import fileRoutes from '@modules/files/files.routes';
import folderRoutes from '@modules/folders/folders.routes';
import trashRoutes from '@modules/trash/trash.routes';
import sharingRoutes from '@modules/sharing/sharing.routes';
import shareLinkRoutes from '@modules/share-links/share-links.routes';
import activityRoutes from '@modules/activity/activity.routes';
import aiRoutes from '@modules/ai/ai.routes';
import { getAiStatus } from '@modules/ai/ai.status';
import path from 'path';

/** Removes query strings and share-link tokens, both of which can grant access, from logged URLs. */
export const safeUrl = (url: string) =>
  url.split('?')[0].replace(/(\/share-links\/public\/)[^/]+/, '$1[token]');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Request ID middleware. Client-supplied ids are only echoed when they are plainly harmless.
app.use((req, res, next) => {
  const supplied = req.headers['x-request-id'];
  const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// Structured logging middleware
app.use((req, res, next) => {
  req.logger = createRequestLogger(req.requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const logData = {
      method: req.method,
      url: safeUrl(req.originalUrl),
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (res.statusCode >= 500) {
      req.logger.error({ ...logData, event: 'http_5xx' }, 'Request failed');
    } else if (res.statusCode >= 400) {
      req.logger.warn(logData, 'Request completed with client error');
    } else if (!logData.url.includes('/health')) {
      req.logger.info(logData, 'Request completed');
    }
  });

  next();
});

app.use(helmet());
app.use(
  cors({
    origin: config.frontend.origins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Auth-Transport', 'X-Share-Password', 'X-Share-Password-Encoding', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Reset'],
    maxAge: 600,
  })
);

// Health endpoints come before the rate limiter: load balancers poll from a few addresses.
app.get(`/api/${config.apiPrefix}/health`, (req, res) => {
  res.json(successResponse({
    status: 'ok',
    service: 'nimbusvault-backend',
    version: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
  }, 'NimbusVault backend running', req.requestId));
});

app.get(`/api/${config.apiPrefix}/health/ready`, async (req, res) => {
  // Reports subsystem state without exposing endpoints, credentials or error details.
  const { prisma } = await import('@database/prisma');
  const { storageService } = await import('@common/storage');

  const database = await prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'unavailable' as const);
  const storage = (await storageService.healthCheck()) ? ('ok' as const) : ('unavailable' as const);
  const ai = getAiStatus();
  const ready = database === 'ok' && storage === 'ok';

  const body = {
    status: ready ? 'ready' : 'degraded',
    checks: {
      database,
      storage,
      // AI is optional: core storage and sharing work without it.
      ai: {
        embeddings: ai.embedding.configured ? 'configured' : 'disabled',
        generation: ai.generation.configured ? 'configured' : 'disabled',
        worker: ai.worker.running ? 'running' : 'stopped',
      },
    },
  };

  if (ready) {
    res.json(successResponse(body, 'Service ready', req.requestId));
  } else {
    res.status(503).json({
      success: false,
      message: 'Service not ready',
      data: body,
      error: { code: 'SERVICE_UNAVAILABLE' },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  }
});

app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', undefined, 'unknown'),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

app.use(`/api/${config.apiPrefix}/auth`, authRoutes);
app.use(`/api/${config.apiPrefix}/users`, userRoutes);
app.use(`/api/${config.apiPrefix}/files`, fileRoutes);
app.use(`/api/${config.apiPrefix}/folders`, folderRoutes);
app.use(`/api/${config.apiPrefix}/trash`, trashRoutes);
app.use(`/api/${config.apiPrefix}/sharing`, sharingRoutes);
app.use(`/api/${config.apiPrefix}/share-links`, shareLinkRoutes);
app.use(`/api/${config.apiPrefix}/activity`, activityRoutes);
app.use(`/api/${config.apiPrefix}/ai`, aiRoutes);

// One same-origin browser URL; service and database ports remain loopback-only.
if (process.env.SERVE_FRONTEND === 'true') {
  const frontend = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontend));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontend, 'index.html')));
}

app.use((req, res) => {
  res.status(404).json(errorResponse('Route not found', 'NOT_FOUND', undefined, req.requestId));
});

/** Maps library errors with a well-defined client meaning; null means "unexpected". */
function toAppError(err: Error & { type?: string }): AppError | null {
  if (err instanceof AppError) return err;

  // Malformed bodies are client errors, not server faults.
  if (err.type === 'entity.too.large') return new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
  if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return AppError.badRequest('Malformed JSON body', 'VALIDATION_ERROR');
  }
  if (err instanceof URIError) return AppError.badRequest('Malformed URL', 'VALIDATION_ERROR');

  if (err instanceof multer.MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? AppError.badRequest(
          `File size exceeds maximum allowed limit (${Math.round(config.storage.maxFileBytes / 1048576)}MB)`,
          'FILE_TOO_LARGE'
        )
      : AppError.badRequest(err.message, 'UPLOAD_ERROR');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return AppError.conflict('An item with these details already exists', 'NAME_CONFLICT');
    if (err.code === 'P2025') return AppError.notFound('The item no longer exists', 'NOT_FOUND');
    if (err.code === 'P2003') return AppError.conflict('A related item no longer exists', 'CONFLICT');
    if (err.code === 'P2023' || err.code === 'P2009') return AppError.badRequest('Invalid value', 'VALIDATION_ERROR');
  }
  // 22021: text PostgreSQL cannot represent, such as a NUL byte in a search term.
  if (
    (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) &&
    err.message.includes('22021')
  ) {
    return AppError.badRequest('Invalid value', 'VALIDATION_ERROR');
  }
  return null;
}

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const requestId = req.requestId || 'unknown';
  const requestLogger = createRequestLogger(requestId);
  const meta = { requestId, timestamp: new Date().toISOString() };

  const known = toAppError(err);
  if (known) {
    requestLogger.warn({ err: known.message, code: known.code, details: known.details }, 'Handled error');
    return res.status(known.statusCode).json({
      success: false,
      message: known.message,
      error: { code: known.code, details: known.details },
      meta,
    });
  }

  requestLogger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_ERROR' },
    meta,
  });
});

export default app;
