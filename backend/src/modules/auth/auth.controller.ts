import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { authService } from './auth.service';
import type { RegisterInput, LoginInput, RefreshInput, LogoutInput } from './auth.validation';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
}

export const authController = {
  register: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const input = req.body as RegisterInput;
    const result = await authService.register(input);

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: result.tokens.expiresIn * 1000,
    });

    res.status(201).json(successResponse(result, 'Registration successful'));
  }),

  login: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const input = req.body as LoginInput;
    const result = await authService.login(input);

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: result.tokens.expiresIn * 1000,
    });

    res.json(successResponse(result, 'Login successful'));
  }),

  refresh: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const input = req.body as RefreshInput;
    const tokens = await authService.refresh(input.refreshToken, input.tokenFamily);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokens.expiresIn * 1000,
    });

    res.json(successResponse(tokens, 'Token refreshed'));
  }),

  logout: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const input = req.body as LogoutInput;
    await authService.logout(input.tokenFamily);

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.json(successResponse(null, 'Logged out successfully'));
  }),

  me: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED' } });
    }

    const user = await authService.me(userId);
    res.json(successResponse(user, 'User profile retrieved'));
  }),
};