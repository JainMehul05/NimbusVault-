import request from 'supertest';
import app from '@app';
import { prisma } from '@/database/prisma';
import { externalScope } from '@/modules/ai/local-intelligence';
import { auth, cleanupUsers, createUser, share, upload, type TestUser } from './helpers';

const EMAILS = ['ext-owner@example.com', 'ext-reader@example.com'];
let owner: TestUser;
let reader: TestUser;

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  owner = await createUser(EMAILS[0]);
  reader = await createUser(EMAILS[1]);
});
afterAll(() => cleanupUsers(EMAILS));

const consent = (u: TestUser, value: boolean) =>
  request(app).put('/api/v1/users/me/ai-preferences').set(auth(u)).send({ externalAiConsent: value });

describe('external AI consent', () => {
  it('is off by default and can be changed only with a boolean', async () => {
    const res = await request(app).get('/api/v1/users/me/ai-preferences').set(auth(owner)).expect(200);
    expect(res.body.data.externalAiConsent).toBe(false);
    await request(app).put('/api/v1/users/me/ai-preferences').set(auth(owner)).send({ externalAiConsent: 'yes' }).expect(400);
    await consent(owner, true).expect(200);
    expect((await prisma.user.findUnique({ where: { id: owner.id } }))?.externalAiConsent).toBe(true);
    await request(app).get('/api/v1/users/me/ai-preferences').expect(401);
  });

  it('sends nothing externally unless the asker consented', async () => {
    const fileId = await upload(owner, 'own.txt', 'owner document');
    expect(await externalScope(owner.id, [fileId])).toEqual([]);
    await consent(owner, true).expect(200);
    expect(await externalScope(owner.id, [fileId])).toEqual([fileId]);
  });

  it("never lets a shared reader's consent release the owner's document", async () => {
    const fileId = await upload(owner, 'shared.txt', 'owner shared document');
    await share(owner, 'FILE', fileId, reader, 'VIEWER');
    await consent(reader, true).expect(200);
    expect(await externalScope(reader.id, [fileId])).toEqual([]);
    await consent(owner, true).expect(200);
    expect(await externalScope(reader.id, [fileId])).toEqual([fileId]);
    await consent(owner, false).expect(200);
    expect(await externalScope(reader.id, [fileId])).toEqual([]);
  });

  it('rejects an unknown provider value on ask', async () => {
    const res = await request(app).post('/api/v1/ai/ask/async').set(auth(owner)).send({ question: 'Anything?', provider: 'paid-api' });
    expect(res.status).toBe(400);
  });
});
