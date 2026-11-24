import request from 'supertest';
import app from '@app';
import { prisma } from '@/database/prisma';
import { auth, cleanupUsers, createFolder, createUser, share, upload, type TestUser } from './helpers';

const EMAILS = ['p3-owner@example.com', 'p3-editor@example.com', 'p3-viewer@example.com', 'p3-stranger@example.com'];
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let folder: string;
let file: string;

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  [owner, editor, viewer, stranger] = await Promise.all([createUser(EMAILS[0]), createUser(EMAILS[1]), createUser(EMAILS[2]), createUser(EMAILS[3])]);
  folder = await createFolder(owner, 'Shared');
  file = await upload(owner, 'plan.txt', 'hello', { folderId: folder });
  await share(owner, 'FOLDER', folder, editor, 'EDITOR');
  await share(owner, 'FOLDER', folder, viewer, 'VIEWER');
});
afterAll(() => cleanupUsers(EMAILS));

const link = async (u: TestUser, body: object = {}) =>
  (await request(app).post('/api/v1/share-links/protected').set(auth(u)).send({ fileId: file, permission: 'DOWNLOAD', ...body }).expect(201)).body.data as { id: string; token: string };
const open = (token: string) => request(app).get(`/api/v1/share-links/public/${token}`);
const download = (token: string) => request(app).get(`/api/v1/share-links/public/${token}/download`);

/** Every state-changing or reading call on a file, with the least role that may perform it. */
const FILE_MATRIX: Array<[string, 'VIEWER' | 'EDITOR' | 'OWNER', (u: TestUser) => request.Test]> = [
  ['read metadata', 'VIEWER', (u) => request(app).get(`/api/v1/files/${file}`).set(auth(u))],
  ['download', 'VIEWER', (u) => request(app).get(`/api/v1/files/${file}/download`).set(auth(u))],
  ['read AI status', 'VIEWER', (u) => request(app).get(`/api/v1/ai/files/${file}`).set(auth(u))],
  ['rename', 'EDITOR', (u) => request(app).patch(`/api/v1/files/${file}/rename`).set(auth(u)).send({ filename: `r-${u.id.slice(0, 6)}.txt` })],
  ['list links', 'EDITOR', (u) => request(app).get(`/api/v1/share-links/protected/${file}`).set(auth(u))],
  ['create link', 'EDITOR', (u) => request(app).post('/api/v1/share-links/protected').set(auth(u)).send({ fileId: file, permission: 'VIEW' })],
  ['list shares', 'EDITOR', (u) => request(app).get(`/api/v1/sharing/FILE/${file}`).set(auth(u))],
  ['upload into folder', 'EDITOR', (u) => request(app).post('/api/v1/files').set(auth(u)).field('folderId', folder).attach('file', Buffer.from('x'), 'up.txt')],
  ['begin presigned upload', 'EDITOR', (u) => request(app).post('/api/v1/files/presigned-upload').set(auth(u)).send({ filename: 'p.txt', contentType: 'text/plain', sizeBytes: 1, folderId: folder })],
  ['move to top level', 'OWNER', (u) => request(app).patch(`/api/v1/files/${file}/move`).set(auth(u)).send({ folderId: null })],
  ['view activity', 'OWNER', (u) => request(app).get(`/api/v1/activity/resource/FILE/${file}`).set(auth(u))],
  ['rename folder', 'OWNER', (u) => request(app).patch(`/api/v1/folders/${folder}/rename`).set(auth(u)).send({ name: 'Renamed' })],
  ['delete folder', 'OWNER', (u) => request(app).delete(`/api/v1/folders/${folder}?deleteDescendants=true`).set(auth(u))],
  ['delete file', 'OWNER', (u) => request(app).delete(`/api/v1/files/${file}`).set(auth(u))],
];
const RANK = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

describe('role matrix (deny by default)', () => {
  it.each(FILE_MATRIX)('%s requires at least %s', async (_name, least, call) => {
    await call(stranger).expect((r) => {
      if (![403, 404].includes(r.status)) throw new Error(`stranger got ${r.status}`);
    });
    for (const [user, role] of [[viewer, 'VIEWER'], [editor, 'EDITOR']] as const) {
      const res = await call(user);
      const allowed = RANK[role] >= RANK[least];
      if (allowed) expect(res.status).toBeLessThan(300);
      else expect([403, 404]).toContain(res.status);
    }
    expect((await call(owner)).status).toBeLessThan(300);
  });

  it('requires authentication everywhere', async () => {
    for (const path of ['/files', '/folders', '/folders/tree', '/trash', '/sharing/me/shared-with-me', '/activity', '/ai/status', '/auth/sessions', '/users/profile', `/share-links/protected/${file}`]) {
      await request(app).get(`/api/v1${path}`).expect(401);
    }
  });
});

describe('revocation takes effect immediately', () => {
  const revoke = (u: TestUser) => request(app).delete(`/api/v1/sharing/FOLDER/${folder}/${u.id}`).set(auth(owner)).expect(200);

  it('removes file, folder, listing and AI access', async () => {
    await request(app).get(`/api/v1/files/${file}/download`).set(auth(viewer)).expect(200);
    await revoke(viewer);
    await request(app).get(`/api/v1/files/${file}/download`).set(auth(viewer)).expect(404);
    await request(app).get(`/api/v1/folders/${folder}/contents`).set(auth(viewer)).expect(404);
    await request(app).get(`/api/v1/ai/files/${file}`).set(auth(viewer)).expect(404);
    const mine = await request(app).get('/api/v1/sharing/me/shared-with-me').set(auth(viewer));
    expect(mine.body.data.pagination.total).toBe(0);
  });

  it('disables share links made by an editor who loses access or is downgraded, and restores them with the role', async () => {
    const { token } = await link(editor);
    await open(token).expect(200);
    await request(app).patch(`/api/v1/sharing/FOLDER/${folder}/${editor.id}`).set(auth(owner)).send({ level: 'VIEWER' }).expect(200);
    expect((await open(token).expect(403)).body.error.code).toBe('SHARE_REVOKED');
    await download(token).expect(403);
    await request(app).patch(`/api/v1/sharing/FOLDER/${folder}/${editor.id}`).set(auth(owner)).send({ level: 'EDITOR' }).expect(200);
    await open(token).expect(200);
    await revoke(editor);
    await open(token).expect(403);
    // The owner's own links are unaffected.
    const own = await link(owner);
    await open(own.token).expect(200);
  });

  it('stops an editor’s pending upload from completing', async () => {
    const begun = await request(app).post('/api/v1/files/presigned-upload').set(auth(editor)).send({ filename: 'p.txt', contentType: 'text/plain', sizeBytes: 1, folderId: folder }).expect(201);
    await revoke(editor);
    await request(app).post(`/api/v1/files/${begun.body.data.fileId}/complete`).set(auth(editor)).expect(404);
  });
});

describe('sharing rules', () => {
  const shareRaw = (u: TestUser, body: object) => request(app).post('/api/v1/sharing').set(auth(u)).send({ resourceType: 'FILE', resourceId: file, level: 'VIEWER', ...body });

  it('does not reveal accounts to people who cannot share the item', async () => {
    const known = await shareRaw(stranger, { granteeEmail: owner.email }).expect(404);
    const unknown = await shareRaw(stranger, { granteeEmail: 'ghost@example.com' }).expect(404);
    expect(known.body.error).toEqual(unknown.body.error);
  });

  it('matches grantee emails regardless of case and reports created vs updated', async () => {
    const first = await shareRaw(owner, { granteeEmail: stranger.email.toUpperCase() }).expect(201);
    expect(first.body.message).toBe('Share permission created');
    const second = await shareRaw(owner, { granteeEmail: stranger.email, level: 'EDITOR' }).expect(201);
    expect(second.body.message).toBe('Share permission updated');
  });

  it('never lets an editor affect the owner, escalate themselves, or touch existing grants', async () => {
    await shareRaw(editor, { granteeEmail: owner.email, level: 'VIEWER' }).expect(400);
    await shareRaw(editor, { granteeEmail: editor.email, level: 'EDITOR' }).expect(400);
    await request(app).patch(`/api/v1/sharing/FOLDER/${folder}/${viewer.id}`).set(auth(editor)).send({ level: 'EDITOR' }).expect(403);
    await request(app).delete(`/api/v1/sharing/FOLDER/${folder}/${viewer.id}`).set(auth(editor)).expect(403);
    await request(app).post('/api/v1/sharing').set(auth(viewer)).send({ resourceType: 'FOLDER', resourceId: folder, granteeEmail: stranger.email, level: 'VIEWER' }).expect(403);
  });

  it('pages through shared items and lists each file once at its strongest level', async () => {
    await share(owner, 'FILE', file, viewer, 'EDITOR'); // also inherited as VIEWER
    for (let i = 0; i < 4; i++) await upload(owner, `n${i}.txt`, 'x', { folderId: folder });
    const page = async (n: number) => (await request(app).get(`/api/v1/sharing/me/shared-with-me?page=${n}&limit=2`).set(auth(viewer)).expect(200)).body.data;
    const all: Array<{ id: string; permission: string }> = [];
    for (let n = 1; n <= 3; n++) {
      const d = await page(n);
      expect(d.pagination).toMatchObject({ total: 6, totalPages: 3 });
      expect(d.files.length + d.folders.length).toBe(2);
      all.push(...d.folders, ...d.files);
    }
    expect(new Set(all.map((x) => x.id)).size).toBe(6);
    expect(all.find((x) => x.id === file)!.permission).toBe('EDITOR');
    await request(app).get('/api/v1/sharing/me/shared-with-me?limit=1000').set(auth(viewer)).expect(400);
  });

  it('a stronger grant on an ancestor wins over a weaker one below it', async () => {
    const sub = await createFolder(owner, 'Sub', folder);
    const deep = await upload(owner, 'deep.txt', 'x', { folderId: sub });
    await share(owner, 'FOLDER', sub, editor, 'VIEWER');
    await request(app).patch(`/api/v1/files/${deep}/rename`).set(auth(editor)).send({ filename: 'deeper.txt' }).expect(200);
  });
});

describe('share links', () => {
  it('accepts non-ASCII passwords via the percent-encoded header and never caches responses', async () => {
    const { token } = await link(owner, { password: 'пароль-é1' });
    const res = await open(token).set('X-Share-Password', encodeURIComponent('пароль-é1')).set('X-Share-Password-Encoding', 'percent').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await open(token).set('X-Share-Password', '%E0%A4%A').set('X-Share-Password-Encoding', 'percent').expect(403);
    expect((await open(token).expect(403)).body.error.code).toBe('PASSWORD_REQUIRED');
  });

  it('does not consume a download when storage cannot issue a URL, and view-only links cannot download', async () => {
    const limited = await link(owner, { maxDownloads: 1 });
    const { storageService } = await import('@/common/storage');
    const spy = jest.spyOn(storageService, 'generatePresignedDownloadUrl').mockRejectedValueOnce(new Error('down'));
    await download(limited.token).expect(500);
    spy.mockRestore();
    await download(limited.token).expect(200);
    expect((await download(limited.token).expect(403)).body.error.code).toBe('SHARE_EXHAUSTED');
    const viewOnly = await link(owner, { permission: 'VIEW' });
    await download(viewOnly.token).expect(403);
  });

  it('stops working when the file is deleted, and works again if it is restored', async () => {
    const { token } = await link(owner);
    await request(app).delete(`/api/v1/files/${file}`).set(auth(owner)).expect(200);
    await open(token).expect(404);
    await request(app).post(`/api/v1/trash/files/${file}/restore`).set(auth(owner)).expect(200);
    await open(token).expect(200);
  });

  it('cannot outlive its expiry even if validation raced it', async () => {
    const { id, token } = await link(owner, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await prisma.shareLink.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const { shareLinkService } = await import('@/modules/share-links/share-links.service');
    await expect(shareLinkService.consumeDownload(id)).rejects.toMatchObject({ statusCode: 403 });
    await open(token).expect(403);
  });

  it('only its creator or the owner may revoke it', async () => {
    const { id } = await link(editor);
    await request(app).delete(`/api/v1/share-links/protected/${id}`).set(auth(viewer)).expect(403);
    await request(app).delete(`/api/v1/share-links/protected/${id}`).set(auth(owner)).expect(200);
  });
});

describe('activity', () => {
  it('cannot be widened by any filter or resource id', async () => {
    const all = await request(app).get('/api/v1/activity').query({ resourceId: file, limit: 100 }).set(auth(stranger)).expect(200);
    expect(all.body.data.entries).toEqual([]);
    await request(app).get('/api/v1/activity').query({ userId: owner.id }).set(auth(stranger)).expect(403);
    await request(app).get(`/api/v1/activity/resource/FILE/${file}`).set(auth(stranger)).expect(404);
    await request(app).get(`/api/v1/activity/resource/SHARE_LINK/${file}`).set(auth(stranger)).expect(400);
    await request(app).get('/api/v1/activity').query({ startDate: '2026-02-01T00:00:00Z', endDate: '2026-01-01T00:00:00Z' }).set(auth(owner)).expect(400);
  });

  it('records restore, purge and session events', async () => {
    await request(app).delete(`/api/v1/files/${file}`).set(auth(owner));
    await request(app).post(`/api/v1/trash/files/${file}/restore`).set(auth(owner));
    await request(app).delete(`/api/v1/files/${file}`).set(auth(owner));
    await request(app).delete(`/api/v1/trash/files/${file}`).set(auth(owner));
    const feed = await request(app).get('/api/v1/activity?limit=100').set(auth(owner));
    const actions = feed.body.data.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['file_delete', 'file_restore', 'file_purge']));
  });
});
