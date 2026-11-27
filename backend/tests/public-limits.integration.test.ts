import request from 'supertest';
import app from '@app';
import { prisma } from '@/database/prisma';
import { gatewayClientIp, originSecretValid } from '@/common/public-limits';
import { askJobs } from '@/modules/ai/ask-jobs';
import { auth, cleanupUsers, createUser, upload, type TestUser } from './helpers';

const EMAILS = ['pub-a@example.com', 'pub-b@example.com', 'pub-new@example.com', 'pub-new2@example.com'];
const ENV = ['REGISTRATION_MODE', 'REGISTRATION_INVITE_CODE', 'MAX_USERS', 'DEFAULT_STORAGE_QUOTA_BYTES', 'MAX_FILES_PER_USER',
  'GLOBAL_STORAGE_CAP_BYTES', 'UPLOAD_ALLOWED_EXTENSIONS', 'AI_DAILY_QUESTION_LIMIT', 'ORIGIN_SHARED_SECRET'];
const saved: Record<string, string | undefined> = {};
const register = (email: string, inviteCode?: string) =>
  request(app).post('/api/v1/auth/register').send({ name: 'Public Tester', email, password: 'Password123!', ...(inviteCode ? { inviteCode } : {}) });
let a: TestUser;
let b: TestUser;

beforeAll(() => ENV.forEach((k) => { saved[k] = process.env[k]; }));
beforeEach(async () => {
  ENV.forEach((k) => delete process.env[k]);
  askJobs.clear();
  await cleanupUsers(EMAILS);
  a = await createUser(EMAILS[0]);
  b = await createUser(EMAILS[1]);
});
afterAll(async () => {
  ENV.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  await cleanupUsers(EMAILS);
});

describe('registration policy', () => {
  it('keeps open registration by default (Windows behaviour)', async () => {
    await register(EMAILS[2]).expect(201);
    const user = await prisma.user.findUnique({ where: { email: EMAILS[2] } });
    expect(user?.storageQuotaBytes).toBe(5368709120n);
  });

  it('requires the exact invitation code in invite mode and applies the public quota', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    process.env.REGISTRATION_INVITE_CODE = 'demo-code-2026';
    process.env.DEFAULT_STORAGE_QUOTA_BYTES = '20971520';
    expect((await register(EMAILS[2])).status).toBe(403);
    expect((await register(EMAILS[2], 'demo-code-2027')).body.error.code).toBe('INVITE_REQUIRED');
    await register(EMAILS[2], 'demo-code-2026').expect(201);
    const user = await prisma.user.findUnique({ where: { email: EMAILS[2] } });
    expect(user?.storageQuotaBytes).toBe(20971520n);
  });

  it('accepts any of several configured invitation codes', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    process.env.REGISTRATION_INVITE_CODE = 'student-code-1, professor-code-2';
    await register(EMAILS[2], 'professor-code-2').expect(201);
    await register(EMAILS[3], 'student-code-1').expect(201);
  });

  it('fails closed when invite mode has no configured code, and honours closed mode and the account cap', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    expect((await register(EMAILS[2], 'anything-at-all')).status).toBe(403);
    process.env.REGISTRATION_MODE = 'closed';
    expect((await register(EMAILS[2])).body.error.code).toBe('REGISTRATION_CLOSED');
    process.env.REGISTRATION_MODE = 'open';
    process.env.MAX_USERS = String(await prisma.user.count());
    expect((await register(EMAILS[3])).body.error.code).toBe('ACCOUNT_LIMIT');
  });

  it('reports the registration mode on the public health endpoint', async () => {
    process.env.REGISTRATION_MODE = 'invite';
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.data.registration).toBe('invite');
  });
});

describe('upload limits', () => {
  it('enforces the file-type allow-list and per-user file count', async () => {
    process.env.UPLOAD_ALLOWED_EXTENSIONS = 'txt,md';
    process.env.MAX_FILES_PER_USER = '1';
    await expect(upload(a, 'notes.csv', 'a,b\n1,2\n', { contentType: 'text/csv' })).rejects.toThrow(/400/);
    await upload(a, 'one.txt', 'first file');
    await expect(upload(a, 'two.txt', 'second file')).rejects.toThrow(/403/);
    await upload(b, 'other.txt', 'other user unaffected');
  });

  it('enforces the global storage cap', async () => {
    const total = await prisma.user.aggregate({ _sum: { storageUsedBytes: true } });
    process.env.GLOBAL_STORAGE_CAP_BYTES = String(Number(total._sum.storageUsedBytes ?? 0n) + 5);
    await expect(upload(a, 'big.txt', 'more than five bytes')).rejects.toThrow(/403/);
  });
});

describe('asynchronous answers', () => {
  it('returns 202 with a job, lets only the owner poll it, and completes', async () => {
    const start = await request(app).post('/api/v1/ai/ask/async').set(auth(a)).send({ question: 'What is in my files?' }).expect(202);
    const jobId = start.body.data.jobId;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    await request(app).get(`/api/v1/ai/ask/async/${jobId}`).set(auth(b)).expect(404);
    let state = 'running';
    for (let i = 0; i < 50 && state === 'running'; i++) {
      const poll = await request(app).get(`/api/v1/ai/ask/async/${jobId}`).set(auth(a)).expect(200);
      state = poll.body.data.state;
      if (state === 'running') await new Promise((r) => setTimeout(r, 100));
    }
    expect(['done', 'error']).toContain(state);
  });

  it('enforces the daily question allowance', async () => {
    process.env.AI_DAILY_QUESTION_LIMIT = '1';
    await prisma.activityLog.create({ data: { userId: a.id, action: 'ai_query', resourceType: 'USER', resourceId: a.id } });
    const res = await request(app).post('/api/v1/ai/ask/async').set(auth(a)).send({ question: 'Another question?' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('AI_DAILY_LIMIT');
  });
});

describe('origin secret', () => {
  it('accepts only the exact configured secret of sufficient length', () => {
    expect(originSecretValid('x')).toBe(false);
    process.env.ORIGIN_SHARED_SECRET = 'short';
    expect(originSecretValid('short')).toBe(false);
    process.env.ORIGIN_SHARED_SECRET = 's'.repeat(40);
    expect(originSecretValid('s'.repeat(40))).toBe(true);
    expect(originSecretValid('s'.repeat(39) + 't')).toBe(false);
    expect(originSecretValid(undefined)).toBe(false);
  });

  it('accepts only a single valid address as the gateway client IP', () => {
    expect(gatewayClientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(gatewayClientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(gatewayClientIp('203.0.113.7, 10.0.0.1')).toBeNull();
    expect(gatewayClientIp('not-an-ip')).toBeNull();
    expect(gatewayClientIp(undefined)).toBeNull();
  });
});
