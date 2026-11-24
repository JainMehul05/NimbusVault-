import type { Request } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { createHash } from 'crypto';
import { config } from '@config/index';
import { errorResponse } from '@common/response';

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MESSAGE = 'Too many failed sign-ins for this account. Please wait 15 minutes and try again.';

const limiter = (max: number, message: string, options: Partial<Options> = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: errorResponse(message, 'RATE_LIMIT_EXCEEDED'),
    ...options,
  });

/** Emails are hashed so limiter keys never hold personal data. */
const accountKey = (req: Request) =>
  createHash('sha256').update(String((req.body as { email?: string })?.email ?? '')).digest('base64url');

/** Per IP, across every credential endpoint. */
export const credentialLimiter = limiter(config.rateLimit.authMax, 'Too many attempts. Please wait and try again.');

/** Token refresh and sign-out, which browsers call routinely. */
export const refreshLimiter = limiter(config.rateLimit.refreshMax, 'Too many attempts. Please wait and try again.');

/**
 * Failed sign-ins per account. Applied identically whether or not the account exists, so the
 * limit itself cannot be used to discover accounts. Successful sign-ins are not counted.
 */
export const createAccountFailureLimiters = (perIp: number, total: number) => ({
  perIp: limiter(perIp, ACCOUNT_MESSAGE, {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${accountKey(req)}|${req.ip}`,
  }),
  /** Ceiling across all addresses, against distributed guessing of one account. */
  total: limiter(total, ACCOUNT_MESSAGE, { skipSuccessfulRequests: true, keyGenerator: accountKey }),
});

const accountLimiters = createAccountFailureLimiters(config.rateLimit.accountFailuresPerIp, config.rateLimit.accountFailures);
export const accountIpFailureLimiter = accountLimiters.perIp;
export const accountFailureLimiter = accountLimiters.total;
