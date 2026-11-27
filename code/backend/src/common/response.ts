export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export function successResponse<T>(data: T, message = 'Success', requestId?: string): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
    meta: {
      requestId: requestId || 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
}

export function errorResponse(message: string, code: string, details?: unknown, requestId?: string): ApiResponse {
  return {
    success: false,
    message,
    error: {
      code,
      details,
    },
    meta: {
      requestId: requestId || 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
}