import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { config } from '@config/index';

export interface AccessTokenPayload {
  userId: string;
  email: string;
  /** Session id (also the refresh-token family). */
  sid: string;
  type: 'access';
}

const signOptions: SignOptions = {
  algorithm: 'HS256',
  expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'],
};

export function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, config.jwt.accessSecret, signOptions);
}

/** Verifies signature, algorithm, expiry and shape. Refresh tokens are opaque, so none are JWTs. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as Partial<AccessTokenPayload>;
  if (payload.type !== 'access' || typeof payload.userId !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('Not an access token');
  }
  return payload as AccessTokenPayload;
}
