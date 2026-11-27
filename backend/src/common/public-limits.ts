import { timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import prisma from '@database/prisma';
import { AppError, ErrorCodes } from '@common/errors';

/**
 * Public-deployment safeguards. Every limit is opt-in through the environment so the Windows
 * standalone application keeps its original behaviour (open registration, 5 GiB quota, no caps).
 */
const int = (name: string) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export type RegistrationMode = 'open' | 'invite' | 'closed';

export const publicLimits = {
  registrationMode: (): RegistrationMode => {
    const mode = (process.env.REGISTRATION_MODE || 'open').toLowerCase();
    return mode === 'invite' || mode === 'closed' ? mode : 'open';
  },
  maxUsers: () => int('MAX_USERS'),
  defaultQuotaBytes: () => int('DEFAULT_STORAGE_QUOTA_BYTES'),
  maxFilesPerUser: () => int('MAX_FILES_PER_USER'),
  globalStorageCapBytes: () => int('GLOBAL_STORAGE_CAP_BYTES'),
  aiDailyQuestions: () => int('AI_DAILY_QUESTION_LIMIT'),
  allowedExtensions: () =>
    (process.env.UPLOAD_ALLOWED_EXTENSIONS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
};

function codesMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Enforces the registration policy before an account is created. */
export async function assertRegistrationAllowed(inviteCode?: string): Promise<void> {
  const mode = publicLimits.registrationMode();
  if (mode === 'closed') {
    throw AppError.forbidden('Registration is closed on this deployment', 'REGISTRATION_CLOSED');
  }
  if (mode === 'invite') {
    // Comma-separated so each audience (e.g. a professor) can hold its own revocable code.
    const codes = (process.env.REGISTRATION_INVITE_CODE || '').split(',').map((c) => c.trim()).filter((c) => c.length >= 8);
    // A missing server-side code fails closed rather than admitting everyone.
    const supplied = (inviteCode ?? '').trim();
    if (!codes.length || !supplied || !codes.some((code) => codesMatch(supplied, code))) {
      throw AppError.forbidden('A valid invitation code is required to register', 'INVITE_REQUIRED');
    }
  }
  const cap = publicLimits.maxUsers();
  if (cap && (await prisma.user.count()) >= cap) {
    throw AppError.forbidden('This demonstration has reached its account limit', 'ACCOUNT_LIMIT');
  }
}

/** Applies the deployment's default per-user quota to a newly created account. */
export async function applyDefaultQuota(userId: string): Promise<void> {
  const quota = publicLimits.defaultQuotaBytes();
  if (quota) await prisma.user.update({ where: { id: userId }, data: { storageQuotaBytes: BigInt(quota) } });
}

/** File-type allow-list, per-user file count and global storage cap for uploads. */
export async function assertUploadAllowed(ownerId: string, filename: string, sizeBytes: bigint): Promise<void> {
  const allowed = publicLimits.allowedExtensions();
  if (allowed.length) {
    const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    if (!allowed.includes(extension)) {
      throw AppError.badRequest(`Only ${allowed.join(', ')} files are accepted on this deployment`, ErrorCodes.UNSUPPORTED_TYPE);
    }
  }
  const maxFiles = publicLimits.maxFilesPerUser();
  if (maxFiles) {
    const count = await prisma.file.count({ where: { ownerId, deletedAt: null } });
    if (count >= maxFiles) {
      throw AppError.forbidden(`File limit reached (${maxFiles} files per account)`, ErrorCodes.QUOTA_EXCEEDED);
    }
  }
  const cap = publicLimits.globalStorageCapBytes();
  if (cap) {
    const total = await prisma.user.aggregate({ _sum: { storageUsedBytes: true } });
    if ((total._sum.storageUsedBytes ?? 0n) + sizeBytes > BigInt(cap)) {
      throw AppError.forbidden('This demonstration has reached its total storage limit', ErrorCodes.QUOTA_EXCEEDED);
    }
  }
}

/** Per-user rolling 24-hour question limit, counted from the persistent activity log. */
export async function assertAiDailyAllowance(userId: string): Promise<void> {
  const limit = publicLimits.aiDailyQuestions();
  if (!limit) return;
  const used = await prisma.activityLog.count({
    where: { userId, action: 'ai_query', createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (used >= limit) {
    throw new AppError(`Daily question limit reached (${limit} per 24 hours)`, 429, 'AI_DAILY_LIMIT');
  }
}

/**
 * Requests arriving on the public origin port must carry the secret header that only the
 * CloudFront distribution adds, so the origin cannot be used directly to bypass CloudFront.
 */
export function originSecretValid(header: string | undefined): boolean {
  const expected = process.env.ORIGIN_SHARED_SECRET || '';
  return expected.length >= 32 && typeof header === 'string' && codesMatch(header, expected);
}

/** A single, syntactically valid IPv4/IPv6 address from the gateway's client-IP header, else null. */
export function gatewayClientIp(header: string | undefined): string | null {
  const value = (header ?? '').trim();
  if (isIP(value)) return value;
  return null;
}
