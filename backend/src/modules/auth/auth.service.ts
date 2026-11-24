import bcrypt from 'bcrypt';
import { AppError, ErrorCodes } from '@common/errors';
import { config } from '@config/index';
import prisma from '@database/prisma';
import { userService } from '@modules/users/user.service';
import { activityLogService } from '@modules/activity/activity.service';
import { tokenService } from './token.service';
import { generateAccessToken } from './jwt.utils';

export interface RequestMeta {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenFamily: string;
  /** Seconds until the refresh token expires. */
  expiresIn: number;
}

export interface AuthResult {
  user: { id: string; name: string; email: string };
  tokens: AuthTokens;
}

/** Compared against when no account matches, so response time does not reveal which emails exist. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('nimbusvault-timing-equalizer', config.bcrypt.rounds));

const invalidCredentials = () => AppError.unauthorized('Invalid credentials', ErrorCodes.INVALID_CREDENTIALS);

export class AuthService {
  private async openSession(user: { id: string; name: string; email: string }, meta: RequestMeta): Promise<AuthResult> {
    const issued = await tokenService.startSession(user.id, meta);
    return {
      user: { id: user.id, name: user.name, email: user.email },
      tokens: this.toTokens(user, issued),
    };
  }

  private toTokens(
    user: { id: string; email: string },
    issued: { token: string; tokenFamily: string; expiresAt: Date }
  ): AuthTokens {
    return {
      accessToken: generateAccessToken({ userId: user.id, email: user.email, sid: issued.tokenFamily }),
      refreshToken: issued.token,
      refreshTokenFamily: issued.tokenFamily,
      expiresIn: Math.max(0, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  async register(input: RegisterInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, config.bcrypt.rounds);
    const user = await userService.create({ name: input.name, email: input.email, passwordHash });
    return this.openSession(user, meta);
  }

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const user = await userService.findByEmail(input.email);

    if (!user) {
      // No event: there is no account to attribute it to (and logging would enable enumeration).
      await bcrypt.compare(input.password, await getDummyHash());
      throw invalidCredentials();
    }

    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      // Recorded against the targeted account so its owner can see failed attempts.
      await this.log(user.id, 'auth_failed_login', meta);
      throw invalidCredentials();
    }

    // Checked only after the password, so account state is not disclosed to strangers.
    if (user.status !== 'active') {
      throw AppError.forbidden('This account is not active', 'ACCOUNT_INACTIVE');
    }

    const result = await this.openSession(user, meta);
    await userService.touchLastLogin(user.id);
    await this.log(user.id, 'auth_login', meta);
    return result;
  }

  async refresh(refreshToken: string, tokenFamily: string, meta: RequestMeta = {}): Promise<AuthTokens> {
    const issued = await tokenService.rotateRefreshToken(refreshToken, tokenFamily, meta);
    const user = await userService.findById(issued.userId);
    if (!user || user.status !== 'active') {
      await tokenService.revokeSession(tokenFamily);
      throw AppError.unauthorized('Account is not available', 'USER_NOT_FOUND');
    }
    return this.toTokens(user, issued);
  }

  async logout(tokenFamily: string, meta: RequestMeta = {}): Promise<void> {
    const userId = await tokenService.revokeSession(tokenFamily);
    if (userId) await this.log(userId, 'auth_logout', meta);
  }

  async logoutByRefreshToken(refreshToken: string, tokenFamily: string, meta: RequestMeta = {}): Promise<void> {
    const userId = await tokenService.revokeByRefreshToken(refreshToken, tokenFamily);
    if (userId) await this.log(userId, 'auth_logout', meta);
  }

  async me(userId: string) {
    const user = await userService.findById(userId);
    if (!user) {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    return user;
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await tokenService.listSessions(userId);
    return sessions.map((s) => ({
      id: s.id,
      device: s.device,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSessionId,
    }));
  }

  /** Ends one of the caller's own sessions. Other users' session ids behave as if absent. */
  async revokeSession(userId: string, sessionId: string, meta: RequestMeta = {}): Promise<void> {
    const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.revokedAt) {
      throw AppError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    await tokenService.revokeSession(sessionId);
    await this.log(userId, 'auth_session_revoke', meta, { sessions: 1 });
  }

  async revokeOtherSessions(userId: string, currentSessionId: string, meta: RequestMeta = {}): Promise<number> {
    const count = await tokenService.revokeAllSessions(userId, currentSessionId);
    if (count) await this.log(userId, 'auth_session_revoke', meta, { sessions: count });
    return count;
  }

  /** Changes the password and signs out every other device. */
  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta = {}
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw AppError.badRequest('Current password is incorrect', ErrorCodes.INVALID_CREDENTIALS);
    }
    if (currentPassword === newPassword) {
      throw AppError.badRequest('New password must be different', ErrorCodes.VALIDATION_ERROR);
    }
    const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.rounds);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await tokenService.revokeAllSessions(userId, sessionId);
    await this.log(userId, 'auth_password_change', meta);
  }

  private log(
    userId: string,
    action: 'auth_login' | 'auth_failed_login' | 'auth_logout' | 'auth_password_change' | 'auth_session_revoke',
    meta: RequestMeta,
    metadata?: Record<string, number>
  ) {
    return activityLogService.logActivity(userId, action, {
      resourceType: 'USER',
      resourceId: userId,
      targetOwnerId: userId,
      ipAddress: meta.ipAddress,
      metadata,
      requestId: meta.requestId,
    });
  }
}

export const authService = new AuthService();
