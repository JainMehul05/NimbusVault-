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
      url: req.originalUrl,
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
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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
  try {
    // Check database
    const { prisma } = await import('@database/prisma');
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis
    // TODO: Add Redis health check when Redis is configured

    res.json(successResponse({
      status: 'ready',
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    }, 'Service ready', req.requestId));
  } catch (error) {
    res.status(503).json({
      success: false,
      message: 'Service not ready',
      error: { code: 'SERVICE_UNAVAILABLE' },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.use(`/api/${config.apiPrefix}/auth`, authRoutes);
app.use(`/api/${config.apiPrefix}/users`, userRoutes);

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

  requestLogger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_ERROR' },
    meta: { requestId, timestamp: new Date().toISOString() },
  });
});

export default app;