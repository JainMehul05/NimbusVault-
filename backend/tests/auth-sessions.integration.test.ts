import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import app, { safeUrl } from '@app';
import { prisma } from '@/database/prisma';
import { config, normalizeApiPrefix, parseDuration, parseTrustProxy, productionConfigProblems, resolveDatabaseUrl } from '@/config/index';
import { createAccountFailureLimiters } from '@/modules/auth/auth.limits';
import { hashRefreshToken, tokenService } from '@/modules/auth/token.service';
import { auth, cleanupUsers, createUser, type TestUser } from './helpers';

const EMAILS = ['sess-a@example.com', 'sess-b@example.com', 'sess-new@example.com'];
const PW = 'password123';
let a: TestUser;
let b: TestUser;

const cookieOf = (res: request.Response): string => {
  const set = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (set ?? []).find((c) => c.startsWith('refreshToken='))!;
};
const cookiePair = (res: request.Response) => cookieOf(res).split(';')[0];
const browserLogin = (email = EMAILS[0]) =>
  request(app).post('/api/v1/auth/login').set('X-Auth-Transport', 'cookie').send({ email, password: PW });
const browserRefresh = (cookie: string) =>
  request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').send({});

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  a = await createUser(EMAILS[0]);
  b = await createUser(EMAILS[1]);
});
afterAll(() => cleanupUsers(EMAILS));

describe('cookie transport', () => {
  it('sets a hardened cookie and keeps the refresh token out of the body', async () => {
    const res = await browserLogin().expect(200);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.tokens.accessToken).toBeDefined();
    const token = cookiePair(res).split('.').slice(1).join('.');
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
  });

  it('refreshes from the cookie, rotates it, and never reveals the new token to script', async () => {
    const first = cookiePair(await browserLogin());
    const res = await browserRefresh(first).expect(200);
    const second = cookiePair(res);
    expect(second).not.toBe(first);
    expect(Object.keys(res.body.data).sort()).toEqual(['accessToken', 'expiresIn']);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`).expect(200);
  });

  it('rejects cookie refresh and logout without the CSRF header or from another origin', async () => {
    const cookie = cookiePair(await browserLogin());
    const noHeader = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(403);
    expect(noHeader.body.error.code).toBe('CSRF_REJECTED');
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').set('Origin', 'https://evil.example').send({}).expect(403);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).send({}).expect(403);
    // The session survived every forged attempt.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').set('Origin', config.frontend.url).send({}).expect(200);
  });

  it('clears a dead cookie and reports missing credentials', async () => {
    const res = await browserRefresh(`refreshToken=${randomUUID()}.nonsense`).expect(401);
    expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app).post('/api/v1/auth/refresh').send({}).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'x' }).expect(400);
  });

  it('logs out by cookie', async () => {
    const login = await browserLogin();
    const cookie = cookiePair(login);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').send({}).expect(200);
    await browserRefresh(cookie).expect(401);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`).expect(401);
  });
});

describe('refresh rotation', () => {
  it('ends the whole session when a rotated token is replayed', async () => {
    const first = cookiePair(await browserLogin());
    const rotated = await browserRefresh(first).expect(200);
    const reuse = await browserRefresh(first).expect(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    await browserRefresh(cookiePair(rotated)).expect(401);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${rotated.body.data.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
  });

  it('lets exactly one of several simultaneous refreshes win', async () => {
    const cookie = cookiePair(await browserLogin());
    const results = await Promise.all([1, 2, 3, 4].map(() => browserRefresh(cookie)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const family = cookie.split('=')[1].split('.')[0];
    expect(await prisma.refreshToken.count({ where: { tokenFamily: family, revokedAt: null } })).toBeLessThanOrEqual(1);
  });

  it('treats losing the database race as a benign conflict', async () => {
    const issued = await tokenService.startSession(a.id);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ refreshToken: { updateMany: async () => ({ count: 0 }) } })) as never);
    await expect(tokenService.rotateRefreshToken(issued.token, issued.tokenFamily)).rejects.toMatchObject({ code: 'REFRESH_CONFLICT', statusCode: 409 });
    spy.mockRestore();
    await expect(tokenService.rotateRefreshToken(issued.token, issued.tokenFamily)).resolves.toMatchObject({ userId: a.id });
  });

  it('rejects expired refresh tokens and sessions past their absolute lifetime', async () => {
    const one = await tokenService.startSession(a.id);
    await prisma.refreshToken.updateMany({ where: { tokenFamily: one.tokenFamily }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(tokenService.rotateRefreshToken(one.token, one.tokenFamily)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });

    const two = await tokenService.startSession(a.id);
    await prisma.userSession.update({ where: { id: two.tokenFamily }, data: { createdAt: new Date(Date.now() - config.session.maxAgeMs - 1000) } });
    await expect(tokenService.rotateRefreshToken(two.token, two.tokenFamily)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('stores only a hash, and still honours tokens issued with bcrypt before the upgrade', async () => {
    const issued = await tokenService.startSession(a.id);
    const row = await prisma.refreshToken.findFirstOrThrow({ where: { tokenFamily: issued.tokenFamily } });
    expect(row.tokenHash).toBe(hashRefreshToken(issued.token));
    expect(row.tokenHash).not.toContain(issued.token);

    const family = randomUUID();
    await prisma.refreshToken.create({ data: { userId: a.id, tokenFamily: family, tokenHash: await bcrypt.hash('legacy-token', 4), expiresAt: new Date(Date.now() + 60_000) } });
    const rotated = await tokenService.rotateRefreshToken('legacy-token', family);
    expect(rotated.userId).toBe(a.id);
    expect(await prisma.userSession.findUnique({ where: { id: family } })).not.toBeNull();
  });
});

describe('access tokens', () => {
  const sign = (payload: object, secret = config.jwt.accessSecret, options: jwt.SignOptions = { expiresIn: '5m' }) => jwt.sign(payload, secret, options);
  const call = (token: string) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  it('rejects expired, wrong-secret, wrong-type, unsigned and session-less tokens', async () => {
    const sid = randomUUID();
    const base = { userId: a.id, email: a.email, sid, type: 'access' };
    await call(sign(base, config.jwt.accessSecret, { expiresIn: -10 })).expect(401);
    await call(sign(base, 'another-secret-that-is-long-enough-123')).expect(401);
    await call(sign({ ...base, type: 'refresh' })).expect(401);
    await call(jwt.sign(base, '', { algorithm: 'none' })).expect(401);
    await call(sign({ userId: a.id, email: a.email, type: 'access' })).expect(401);
    await call(sign(base)).expect(401); // unknown session
  });

  it('cannot borrow another user’s session id', async () => {
    const mine = await tokenService.startSession(b.id);
    await call(sign({ userId: a.id, email: a.email, sid: mine.tokenFamily, type: 'access' })).expect(401);
  });

  it('stops working the moment the account is deactivated', async () => {
    await call(a.token).expect(200);
    await prisma.user.update({ where: { id: a.id }, data: { status: 'suspended' } });
    await call(a.token).expect(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: a.email, password: PW }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_INACTIVE');
    await request(app).post('/api/v1/auth/login').send({ email: a.email, password: 'wrong-pass1' }).expect(401);
  });
});

describe('session management', () => {
  it('lists, revokes one, and revokes all others', async () => {
    await browserLogin();
    await browserLogin();
    const list = await request(app).get('/api/v1/auth/sessions').set(auth(a)).expect(200);
    expect(list.body.data.sessions).toHaveLength(3);
    expect(list.body.data.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = list.body.data.sessions.find((s: { current: boolean }) => !s.current);
    await request(app).delete(`/api/v1/auth/sessions/${other.id}`).set(auth(a)).expect(200);
    await request(app).delete(`/api/v1/auth/sessions/${other.id}`).set(auth(a)).expect(404);

    const rest = await request(app).delete('/api/v1/auth/sessions').set(auth(a)).expect(200);
    expect(rest.body.data.revoked).toBe(1);
    await request(app).get('/api/v1/auth/me').set(auth(a)).expect(200);
  });

  it('cannot see or end another user’s sessions', async () => {
    const theirs = (await request(app).get('/api/v1/auth/sessions').set(auth(b))).body.data.sessions[0];
    await request(app).delete(`/api/v1/auth/sessions/${theirs.id}`).set(auth(a)).expect(404);
    await request(app).get('/api/v1/auth/me').set(auth(b)).expect(200);
  });

  it('changing the password verifies the old one, signs out other devices and keeps this one', async () => {
    const other = await browserLogin();
    await request(app).post('/api/v1/auth/change-password').set(auth(a)).send({ currentPassword: 'nope', newPassword: 'brandnew99' }).expect(400);
    await request(app).post('/api/v1/auth/change-password').set(auth(a)).send({ currentPassword: PW, newPassword: 'short' }).expect(400);
    await request(app).post('/api/v1/auth/change-password').set(auth(a)).send({ currentPassword: PW, newPassword: 'brandnew99' }).expect(200);
    await request(app).get('/api/v1/auth/me').set(auth(a)).expect(200);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${other.body.data.tokens.accessToken}`).expect(401);
    await browserRefresh(cookiePair(other)).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: a.email, password: PW }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: a.email, password: 'brandnew99' }).expect(200);
    expect(await prisma.activityLog.count({ where: { userId: a.id, action: 'auth_password_change' } })).toBe(1);
  });
});

describe('registration and input', () => {
  const register = (body: object) => request(app).post('/api/v1/auth/register').send({ name: 'New User', email: EMAILS[2], password: PW, ...body });

  it('treats emails as case-insensitive', async () => {
    await register({ email: 'Sess-NEW@Example.com' }).expect(201);
    await register({}).expect(409);
    await request(app).post('/api/v1/auth/login').send({ email: 'SESS-new@example.COM', password: PW }).expect(200);
  });

  it('lets exactly one of two simultaneous registrations succeed', async () => {
    const statuses = (await Promise.all([register({}), register({})])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('enforces the password policy', async () => {
    await register({ password: 'onlyletters' }).expect(400);
    await register({ password: '1234567890' }).expect(400);
    await register({ password: `é1${'x'.repeat(71)}` }).expect(400); // > 72 bytes
    await register({ name: '   ' }).expect(400);
  });

  it('gives identical errors for unknown accounts and wrong passwords', async () => {
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: PW }).expect(401);
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: a.email, password: 'wrongpass1' }).expect(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
    expect(unknown.body.message).toBe(wrong.body.message);
  });
});

describe('brute-force limits', () => {
  it('blocks an account after repeated failures, not counting successes, for known and unknown emails alike', async () => {
    const limits = createAccountFailureLimiters(3, 100);
    const mini = express().use(express.json());
    mini.post('/login', limits.perIp, limits.total, (req, res) => res.status(req.body.ok ? 200 : 401).end());
    const tryLogin = (email: string, ok = false) => request(mini).post('/login').send({ email, ok });
    for (let i = 0; i < 5; i++) await tryLogin('x@example.com', true).expect(200);
    for (let i = 0; i < 3; i++) await tryLogin('x@example.com').expect(401);
    await tryLogin('x@example.com').expect(429);
    await tryLogin('y@example.com').expect(401);
  });
});

describe('configuration and logging', () => {
  it('refuses insecure production settings', () => {
    const good = {
      ...config,
      trustProxy: 1,
      jwt: { ...config.jwt, accessSecret: 'q8Zr1vKp4mXw7tYb2nHc5jLd9sGf3aEu', refreshSecret: 'Wm3xQv8Ty1Rb6Kp9Zn4Hc7Jd2Lf5Gs0A' },
      database: { url: 'postgresql://x' },
      aws: { ...config.aws, s3Bucket: 'b' },
      bcrypt: { rounds: 12 },
      frontend: { url: 'https://vault.example.com', origins: ['https://vault.example.com'] },
    } as typeof config;
    expect(productionConfigProblems(good)).toEqual([]);
    const bad = (patch: object) => productionConfigProblems({ ...good, ...patch } as typeof config).length;
    expect(bad({ jwt: { ...good.jwt, refreshSecret: good.jwt.accessSecret } })).toBeGreaterThan(0);
    expect(bad({ jwt: { ...good.jwt, accessSecret: 'change-me-access-secret-at-least-32-characters' } })).toBeGreaterThan(0);
    expect(bad({ jwt: { ...good.jwt, accessSecret: 'a'.repeat(40) } })).toBeGreaterThan(0);
    expect(bad({ database: { url: '' } })).toBeGreaterThan(0);
    expect(bad({ aws: { ...good.aws, s3Bucket: '' } })).toBeGreaterThan(0);
    expect(bad({ bcrypt: { rounds: 4 } })).toBeGreaterThan(0);
    expect(bad({ frontend: { url: 'http://vault.example.com', origins: ['http://vault.example.com'] } })).toBeGreaterThan(0);
    expect(bad({ trustProxy: true })).toBeGreaterThan(0);
    expect(bad({ session: { ...good.session, cookieSameSite: 'none', cookieSecure: false } })).toBeGreaterThan(0);
  });

  it('builds a database URL from parts with strict TLS', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'x' } as NodeJS.ProcessEnv)).toBe('x');
    expect(resolveDatabaseUrl({} as NodeJS.ProcessEnv)).toBe('');
    const url = new URL(resolveDatabaseUrl({ DB_HOST: 'db.internal', DB_USER: 'app', DB_PASSWORD: 'p@ss/w:rd#1', DB_SSL_CA: '/certs/rds.pem' } as unknown as NodeJS.ProcessEnv));
    expect(decodeURIComponent(url.password)).toBe('p@ss/w:rd#1');
    expect(url.searchParams.get('sslaccept')).toBe('strict');
    expect(url.pathname).toBe('/nimbusvault');
  });

  it('parses helper settings', () => {
    expect([parseDuration('7d', 0), parseDuration('15m', 0), parseDuration('90', 0), parseDuration('bad', 5)]).toEqual([604800000, 900000, 90000, 5]);
    expect(['v1', 'api/v1', '/api/v1/', undefined].map(normalizeApiPrefix)).toEqual(['v1', 'v1', 'v1', 'v1']);
    expect([parseTrustProxy(''), parseTrustProxy('2'), parseTrustProxy('10.0.0.0/8, 127.0.0.1')]).toEqual([false, 2, ['10.0.0.0/8', '127.0.0.1']]);
  });

  it('keeps share tokens and query strings out of logs and ignores unsafe request ids', async () => {
    expect(safeUrl('/api/v1/share-links/public/SECRET/download?password=x')).toBe('/api/v1/share-links/public/[token]/download');
    const ok = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(ok.headers['x-request-id']).toBe('abc-123');
    const bad = await request(app).get('/api/v1/health').set('X-Request-Id', 'x y {"injected":1}');
    expect(bad.headers['x-request-id']).not.toContain('injected');
  });

  it('only allows configured origins through CORS', async () => {
    const good = await request(app).options('/api/v1/auth/login').set('Origin', config.frontend.url).set('Access-Control-Request-Method', 'POST');
    expect(good.headers['access-control-allow-origin']).toBe(config.frontend.url);
    const evil = await request(app).options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
