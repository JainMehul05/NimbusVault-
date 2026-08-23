import { AppError } from '@common/errors';
import bcrypt from 'bcrypt';
import { userService } from '@modules/users/user.service';
import { tokenService } from './token.service';
import { generateAccessToken } from './jwt.utils';
import { config } from '@config/index';

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
  expiresIn: number;
}

export class AuthService {
  async register(input: RegisterInput): Promise<{ user: { id: string; name: string; email: string }; tokens: AuthTokens }> {
    const passwordHash = await bcrypt.hash(input.password, config.bcrypt.rounds);

    const user = await userService.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });

    const { token: refreshToken, tokenFamily, expiresAt } = await tokenService.createRefreshToken(user.id);
    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    return {
      user: { id: user.id, name: user.name, email: user.email },
      tokens: {
        accessToken,
        refreshToken,
        refreshTokenFamily: tokenFamily,
        expiresIn,
      },
    };
  }

  async login(input: LoginInput): Promise<{ user: { id: string; name: string; email: string }; tokens: AuthTokens }> {
    const user = await userService.findByEmail(input.email);

    if (!user) {
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isValid) {
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const { token: refreshToken, tokenFamily, expiresAt } = await tokenService.createRefreshToken(user.id);
    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    return {
      user: { id: user.id, name: user.name, email: user.email },
      tokens: {
        accessToken,
        refreshToken,
        refreshTokenFamily: tokenFamily,
        expiresIn,
      },
    };
  }

  async refresh(refreshToken: string, tokenFamily: string): Promise<AuthTokens> {
    const { userId } = await tokenService.verifyRefreshToken(refreshToken, tokenFamily);

    const { token: newRefreshToken, tokenFamily: newTokenFamily, expiresAt } =
      await tokenService.rotateRefreshToken(refreshToken, tokenFamily);

    const user = await userService.findById(userId);
    if (!user) {
      throw AppError.unauthorized('User not found', 'USER_NOT_FOUND');
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenFamily: newTokenFamily,
      expiresIn,
    };
  }

  async logout(tokenFamily: string): Promise<void> {
    await tokenService.revokeTokenFamily(tokenFamily);
  }

  async me(userId: string) {
    const user = await userService.findById(userId);
    if (!user) {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    return user;
  }
}

export const authService = new AuthService();