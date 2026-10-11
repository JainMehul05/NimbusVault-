import type { PrismaClient } from '@prisma/client';
import { AppError } from '@common/errors';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import prisma from '@database/prisma';
import { config } from '@config/index';

export class TokenService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async createRefreshToken(userId: string, tokenFamily?: string): Promise<{ token: string; tokenFamily: string; expiresAt: Date }> {
    const family = tokenFamily || uuidv4();
    const token = uuidv4();
    const tokenHash = await bcrypt.hash(token, config.bcrypt.rounds);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prismaClient.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        tokenFamily: family,
      },
    });

    return { token, tokenFamily: family, expiresAt };
  }

  async verifyRefreshToken(token: string, tokenFamily: string): Promise<{ userId: string }> {
    const storedTokens = await this.prismaClient.refreshToken.findMany({
      where: {
        tokenFamily,
        expiresAt: { gt: new Date() },
      },
    });

    if (storedTokens.length === 0) {
      throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    for (const storedToken of storedTokens) {
      const isValid = await bcrypt.compare(token, storedToken.tokenHash);
      if (isValid) {
        if (storedToken.revokedAt) {
          await this.revokeTokenFamily(tokenFamily);
          throw AppError.unauthorized('Token reuse detected', 'TOKEN_REUSE_DETECTED');
        }
        return { userId: storedToken.userId };
      }
    }

    throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  async revokeTokenFamily(tokenFamily: string): Promise<void> {
    await this.prismaClient.refreshToken.updateMany({
      where: { tokenFamily },
      data: { revokedAt: new Date() },
    });
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.prismaClient.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async rotateRefreshToken(token: string, tokenFamily: string): Promise<{ token: string; tokenFamily: string; expiresAt: Date }> {
    const storedTokens = await this.prismaClient.refreshToken.findMany({
      where: {
        tokenFamily,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    let matchedToken = null;
    for (const storedToken of storedTokens) {
      const isValid = await bcrypt.compare(token, storedToken.tokenHash);
      if (isValid) {
        matchedToken = storedToken;
        break;
      }
    }

    if (!matchedToken) {
      throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    await this.prismaClient.refreshToken.update({
      where: { id: matchedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.createRefreshToken(matchedToken.userId, tokenFamily);
  }
}

export const tokenService = new TokenService();