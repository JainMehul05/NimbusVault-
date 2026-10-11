export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    this.details = details;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): AppError {
    return new AppError(message, 400, code, details);
  }

  static unauthorized(message: string, code = 'UNAUTHORIZED', details?: unknown): AppError {
    return new AppError(message, 401, code, details);
  }

  static forbidden(message: string, code = 'FORBIDDEN', details?: unknown): AppError {
    return new AppError(message, 403, code, details);
  }

  static notFound(message: string, code = 'NOT_FOUND', details?: unknown): AppError {
    return new AppError(message, 404, code, details);
  }

  static conflict(message: string, code = 'CONFLICT', details?: unknown): AppError {
    return new AppError(message, 409, code, details);
  }

  static tooManyRequests(message: string, code = 'RATE_LIMITED', details?: unknown): AppError {
    return new AppError(message, 429, code, details);
  }

  static internal(message: string, code = 'INTERNAL_ERROR', details?: unknown): AppError {
    return new AppError(message, 500, code, details);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE', details?: unknown): AppError {
    return new AppError(message, 503, code, details);
  }
}

export const ErrorCodes = {
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CURSOR: 'INVALID_CURSOR',

  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',

  // Authorization
  FORBIDDEN: 'FORBIDDEN',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  NOT_OWNER: 'NOT_OWNER',

  // Resource
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  SHARE_NOT_FOUND: 'SHARE_NOT_FOUND',

  // Conflict
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  NAME_CONFLICT: 'NAME_CONFLICT',
  FOLDER_CYCLE: 'FOLDER_CYCLE',
  S3_OBJECT_MISSING: 'S3_OBJECT_MISSING',
  ALREADY_FINALIZED: 'ALREADY_FINALIZED',

  // Share
  SHARE_EXPIRED: 'SHARE_EXPIRED',
  SHARE_REVOKED: 'SHARE_REVOKED',
  SHARE_EXHAUSTED: 'SHARE_EXHAUSTED',
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  INVALID_PASSWORD: 'INVALID_PASSWORD',

  // Upload
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // AI
  AI_NOT_INDEXED: 'AI_NOT_INDEXED',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',

  // Internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];