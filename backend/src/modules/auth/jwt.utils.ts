import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { config } from '@config/index';

export interface AccessTokenPayload {
  userId: string;
  email: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  userId: string;
  tokenFamily: string;
  type: 'refresh';
}

const accessSignOptions: SignOptions = { expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'] };
const refreshSignOptions: SignOptions = { expiresIn: config.jwt.refreshExpiresIn as SignOptions['expiresIn'] };

export function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    config.jwt.accessSecret,
    accessSignOptions
  );
}

export function generateRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.jwt.refreshSecret,
    refreshSignOptions
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
}

export function decodeToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.decode(token) as jwt.JwtPayload;
  } catch {
    return null;
  }
}