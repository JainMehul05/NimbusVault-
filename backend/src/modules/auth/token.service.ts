import type { Prisma, PrismaClient, RefreshToken } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { AppError, ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { config } from '@config/index';

type Db = PrismaClient | Prisma.TransactionClient;

export interface IssuedRefreshToken {
  token: string;
  tokenFamily: string;
  expiresAt: Date;
}

export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Refresh tokens are 256-bit random values, so a plain SHA-256 is the right at-rest protection:
 * it is not brute-forceable and, unlike bcrypt, can be looked up with one indexed query.
 */
export const hashRefreshToken = (token: string): string =>
  `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

/**
 * A session is one sign-in on one device. Its id is also the refresh-token family id and the
 * `sid` claim of every access token issued for it, so revoking the session immediately
 * invalidates both the refresh chain and any outstanding access tokens.
 */
export class TokenService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /** Starts a new session and returns its first refresh token. */
  async startSession(userId: string, meta: SessionMeta = {}): Promise<IssuedRefreshToken> {
    const family = randomUUID();
    return this.prismaClient.$transaction(async (tx) => {
      await tx.userSession.create({
        data: { id: family, userId, device: meta.userAgent?.slice(0, 255), ipAddress: meta.ipAddress },
      });
      return this.issue(tx, userId, family, new Date());
    });
  }

  private async issue(db: Db, userId: string, tokenFamily: string, sessionStart: Date): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Math.min(Date.now() + config.session.refreshTtlMs, sessionStart.getTime() + config.session.maxAgeMs)
    );
    await db.refreshToken.create({ data: { userId, tokenHash: hashRefreshToken(token), expiresAt, tokenFamily } });
    return { token, tokenFamily, expiresAt };
  }

  /** The stored token matching `token`, including revoked and expired ones. */
  private async findStored(token: string, tokenFamily: string): Promise<RefreshToken | null> {
    const direct = await this.prismaClient.refreshToken.findFirst({
      where: { tokenFamily, tokenHash: hashRefreshToken(token) },
    });
    if (direct) return direct;

    // Tokens issued before SHA-256 hashing. They disappear after one refresh lifetime.
    const legacy = await this.prismaClient.refreshToken.findMany({
      where: { tokenFamily, tokenHash: { startsWith: '$2' }, expiresAt: { gt: new Date() } },
    });
    for (const row of legacy) {
      if (await bcrypt.compare(token, row.tokenHash)) return row;
    }
    return null;
  }

  /**
   * Exchanges a refresh token for its successor.
   *  - A token that was already rotated or revoked is treated as stolen: the whole session ends.
   *  - Two requests racing with the same token: exactly one wins; the loser gets a 409 and does
   *    not end the session (this is what two tabs refreshing at once look like).
   */
  async rotateRefreshToken(
    token: string,
    tokenFamily: string,
    meta: SessionMeta = {}
  ): Promise<IssuedRefreshToken & { userId: string }> {
    const stored = await this.findStored(token, tokenFamily);
    if (!stored) throw AppError.unauthorized('Invalid refresh token', ErrorCodes.INVALID_REFRESH_TOKEN);

    if (stored.revokedAt) {
      await this.revokeSession(tokenFamily);
      throw AppError.unauthorized('Token reuse detected', ErrorCodes.TOKEN_REUSE_DETECTED);
    }
    if (stored.expiresAt <= new Date()) {
      throw AppError.unauthorized('Refresh token expired', ErrorCodes.TOKEN_EXPIRED);
    }

    return this.prismaClient.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        throw AppError.conflict('This session was just refreshed elsewhere', 'REFRESH_CONFLICT');
      }

      // Sessions started before session tracking existed are adopted on first refresh.
      const session = await tx.userSession.upsert({
        where: { id: tokenFamily },
        create: { id: tokenFamily, userId: stored.userId, device: meta.userAgent?.slice(0, 255), ipAddress: meta.ipAddress },
        update: { lastUsedAt: new Date(), ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}) },
      });
      if (session.revokedAt || session.userId !== stored.userId) {
        throw AppError.unauthorized('Session has ended', ErrorCodes.TOKEN_REVOKED);
      }
      if (session.createdAt.getTime() + config.session.maxAgeMs <= Date.now()) {
        throw AppError.unauthorized('Session has expired', ErrorCodes.TOKEN_EXPIRED);
      }

      const issued = await this.issue(tx, stored.userId, tokenFamily, session.createdAt);
      return { ...issued, userId: stored.userId };
    });
  }

  /** Ends a session. Returns the owner's id when it was still active. */
  async revokeSession(sessionId: string): Promise<string | null> {
    const now = new Date();
    const active = await this.prismaClient.refreshToken.findFirst({
      where: { tokenFamily: sessionId, revokedAt: null },
      select: { userId: true },
    });
    await this.prismaClient.$transaction([
      this.prismaClient.refreshToken.updateMany({ where: { tokenFamily: sessionId, revokedAt: null }, data: { revokedAt: now } }),
      this.prismaClient.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return active?.userId ?? null;
  }

  /** Ends the session a refresh token belongs to, if the token is genuine. */
  async revokeByRefreshToken(token: string, tokenFamily: string): Promise<string | null> {
    const stored = await this.findStored(token, tokenFamily);
    return stored ? this.revokeSession(tokenFamily) : null;
  }

  /** Ends every session of a user, optionally keeping one. Returns how many were ended. */
  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const now = new Date();
    const [, sessions] = await this.prismaClient.$transaction([
      this.prismaClient.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(exceptSessionId ? { tokenFamily: { not: exceptSessionId } } : {}) },
        data: { revokedAt: now },
      }),
      this.prismaClient.userSession.updateMany({
        where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
        data: { revokedAt: now },
      }),
    ]);
    return sessions.count;
  }

  /** Active sessions: not revoked and holding at least one live refresh token. */
  async listSessions(userId: string) {
    const live = await this.prismaClient.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { tokenFamily: true },
      distinct: ['tokenFamily'],
    });
    return this.prismaClient.userSession.findMany({
      where: { userId, revokedAt: null, id: { in: live.map((t) => t.tokenFamily) } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Confirms that an access token's session is still active and belongs to an active user.
   * Runs on every authenticated request, so sign-out and revocation take effect at once.
   */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.prismaClient.userSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, user: { select: { status: true } } },
    });
    return !!session && !session.revokedAt && session.userId === userId && session.user.status === 'active';
  }

  /** Removes refresh tokens and sessions that can no longer be used or detected as reused. */
  async deleteExpired(graceMs = 7 * 86_400_000): Promise<number> {
    const { count } = await this.prismaClient.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - graceMs) } },
    });
    await this.prismaClient.userSession.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - config.session.maxAgeMs - graceMs) } },
    });
    return count;
  }
}

export const tokenService = new TokenService();
