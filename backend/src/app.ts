import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@config/index';
import { errorResponse, successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { createRequestLogger } from '@common/logger';
import authRoutes from '@modules/auth/auth.routes';
import userRoutes from '@modules/users/user.routes';
import fileRoutes from '@modules/files/files.routes';
import folderRoutes from '@modules/folders/folders.routes';
import sharingRoutes from '@modules/sharing/sharing.routes';
import shareLinkRoutes from '@modules/share-links/share-links.routes';
import activityRoutes from '@modules/activity/activity.routes';
import aiRoutes from '@modules/ai/ai.routes';
import { getAiStatus } from '@modules/ai/ai.status';

/** Strips query strings (which may carry share-link passwords) from logged URLs. */
const safeUrl = (url: string) => url.split('?')[0];

const app = express();

// Request ID middleware
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// Structured logging middleware
app.use((req, res, next) => {
  req.logger = createRequestLogger(req.requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: safeUrl(req.originalUrl),
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (res.statusCode >= 500) {
      req.logger.error({ ...logData, err: 'Server error' }, 'Request failed');
    } else if (res.statusCode >= 400) {
      req.logger.warn(logData, 'Request completed with client error');
    } else {
      req.logger.info(logData, 'Request completed');
    }
  });

  next();
});

app.use(helmet());
app.use(cors({
  origin: config.frontend.url,
  credentials: true,
}));
if (config.nodeEnv === 'development') {
  app.use(morgan((tokens, req, res) => `${tokens.method(req, res)} ${safeUrl(tokens.url(req, res) ?? '')} ${tokens.status(req, res)} ${tokens['response-time'](req, res)} ms`));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', undefined, 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get(`/api/${config.apiPrefix}/health`, (req, res) => {
  res.json(successResponse({
    status: 'ok',
    service: 'nimbusvault-backend',
    version: process.env.npm_package_version || '1.0.0',
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

app.use(`/api/${config.apiPrefix}/auth`, authRoutes);
app.use(`/api/${config.apiPrefix}/users`, userRoutes);
app.use(`/api/${config.apiPrefix}/files`, fileRoutes);
app.use(`/api/${config.apiPrefix}/folders`, folderRoutes);
app.use(`/api/${config.apiPrefix}/sharing`, sharingRoutes);
app.use(`/api/${config.apiPrefix}/share-links`, shareLinkRoutes);
app.use(`/api/${config.apiPrefix}/activity`, activityRoutes);
app.use(`/api/${config.apiPrefix}/ai`, aiRoutes);

app.use((req, res) => {
  res.status(404).json(errorResponse('Route not found', 'NOT_FOUND', undefined, req.requestId));
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = req.requestId || 'unknown';
  const requestLogger = createRequestLogger(requestId);

  if (err instanceof AppError) {
    requestLogger.warn({ err: err.message, code: err.code, details: err.details }, 'Handled error');
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: { code: err.code, details: err.details },
      meta: { requestId, timestamp: new Date().toISOString() },
    });
  }

  // Malformed JSON bodies are client errors, not server faults.
  if ((err as { type?: string }).type === 'entity.parse.failed' || (err as { type?: string }).type === 'entity.too.large') {
    const tooLarge = (err as { type?: string }).type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      message: tooLarge ? 'Request body too large' : 'Malformed JSON body',
      error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR' },
      meta: { requestId, timestamp: new Date().toISOString() },
    });
  }

  requestLogger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_ERROR' },
    meta: { requestId, timestamp: new Date().toISOString() },
  });
});

export default app;