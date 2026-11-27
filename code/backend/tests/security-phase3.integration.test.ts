/**
 * Phase 1–3 security and correctness regressions: activity IDOR, object-level authorization,
 * inherited permissions, shared-folder browsing, accurate activity events and share-link hardening.
 * Runs against a real PostgreSQL database and S3-compatible storage.
 */
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import app from '@app';
import { prisma } from '@/database/prisma';
import { storageService } from '@/common/storage';
import { fileService } from '@/modules/files/files.service';
import { ShareLinkService } from '@/modules/share-links/share-links.service';
import { auth, cleanupUsers, createFolder, createUser, share, upload, type TestUser } from './helpers';

const EMAILS = ['sec-alice@example.com', 'sec-bob@example.com', 'sec-carol@example.com'];
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  alice = await createUser(EMAILS[0], 'Alice');
  bob = await createUser(EMAILS[1], 'Bob');
  carol = await createUser(EMAILS[2], 'Carol');
}, 30000);

afterAll(async () => {
  await cleanupUsers(EMAILS);
});

describe('Activity authorization (IDOR)', () => {
  it('rejects ?userId=<another user> and never returns their events', async () => {
    await upload(alice, 'alice-secret.txt', 'top secret');

    const res = await request(app).get(`/api/v1/activity?userId=${alice.id}`).set(auth(bob));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('alice-secret.txt');
  });

  it('scopes the feed to the caller even when filtering and paginating', async () => {
    const fileId = await upload(alice, 'alice-only.txt', 'x');

    // Filter by Alice's resource id + action: Bob still gets nothing.
    const filtered = await request(app)
      .get(`/api/v1/activity?resourceId=${fileId}&action=file_upload&page=1&limit=100`)
      .set(auth(bob))
      .expect(200);
    expect(filtered.body.data.entries).toHaveLength(0);
    expect(filtered.body.data.pagination.total).toBe(0);

    for (let page = 1; page <= 3; page++) {
      const res = await request(app).get(`/api/v1/activity?page=${page}&limit=1`).set(auth(bob)).expect(200);
      for (const e of res.body.data.entries) {
        expect(e.userId === bob.id || e.userId === null || e.performedByYou === false).toBe(true);
        expect(e.resourceId).not.toBe(fileId);
      }
    }

    // Own id is accepted for backward compatibility.
    await request(app).get(`/api/v1/activity?userId=${bob.id}`).set(auth(bob)).expect(200);
  });

  it('protects per-resource activity (owner only) and supports folders', async () => {
    const fileId = await upload(alice, 'r.txt', 'x');
    const folderId = await createFolder(alice, 'Projects');

    await request(app).get(`/api/v1/activity/resource/FILE/${fileId}`).set(auth(bob)).expect(404);
    await share(alice, 'FILE', fileId, bob, 'EDITOR');
    // Collaborators can use the file but cannot read its audit history.
    await request(app).get(`/api/v1/activity/resource/FILE/${fileId}`).set(auth(bob)).expect(403);

    const own = await request(app).get(`/api/v1/activity/resource/FILE/${fileId}`).set(auth(alice)).expect(200);
    expect(own.body.data.entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['file_upload', 'share_create'])
    );
    const folder = await request(app).get(`/api/v1/activity/resource/FOLDER/${folderId}`).set(auth(alice)).expect(200);
    expect(folder.body.data.entries[0].action).toBe('folder_create');
  });

  it('shows owners events others cause on their files, without other actors’ IP addresses', async () => {
    const fileId = await upload(alice, 'shared.txt', 'x');
    await share(alice, 'FILE', fileId, bob, 'VIEWER');
    await request(app).get(`/api/v1/files/${fileId}/download`).set(auth(bob)).expect(200);

    const feed = await request(app).get('/api/v1/activity?action=file_download').set(auth(alice)).expect(200);
    const entry = feed.body.data.entries.find((e: { userId: string }) => e.userId === bob.id);
    expect(entry).toBeDefined();
    expect(entry.ipAddress).toBeNull();
    expect(entry.performedByYou).toBe(false);
  });
});

describe('Object-level authorization on files and folders', () => {
  it('viewers and editors cannot delete; quota is released from the owner', async () => {
    const fileId = await upload(alice, 'keep.txt', '12345');
    await share(alice, 'FILE', fileId, bob, 'VIEWER');
    await share(alice, 'FILE', fileId, carol, 'EDITOR');

    await request(app).delete(`/api/v1/files/${fileId}`).set(auth(bob)).expect(403);
    await request(app).delete(`/api/v1/files/${fileId}`).set(auth(carol)).expect(403);
    expect((await prisma.file.findUnique({ where: { id: fileId } }))!.deletedAt).toBeNull();

    const before = (await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes;
    const carolBefore = (await prisma.user.findUnique({ where: { id: carol.id } }))!.storageUsedBytes;
    await request(app).delete(`/api/v1/files/${fileId}`).set(auth(alice)).expect(200);
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes).toBe(before - 5n);
    expect((await prisma.user.findUnique({ where: { id: carol.id } }))!.storageUsedBytes).toBe(carolBefore);
    // Deleting twice does not release quota twice.
    await request(app).delete(`/api/v1/files/${fileId}`).set(auth(alice)).expect(404);
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes).toBe(before - 5n);
  });

  it('viewers cannot move; editors cannot move a file out of the owner’s tree', async () => {
    const shared = await createFolder(alice, 'Shared');
    const other = await createFolder(alice, 'Other');
    const bobFolder = await createFolder(bob, 'Bob stuff');
    const fileId = await upload(alice, 'doc.txt', 'x', { folderId: shared });
    await share(alice, 'FOLDER', shared, bob, 'VIEWER');
    await share(alice, 'FOLDER', shared, carol, 'EDITOR');

    await request(app).patch(`/api/v1/files/${fileId}/move`).set(auth(bob)).send({ folderId: null }).expect(403);
    // Editor cannot pull the owner's file into their own folder…
    const carolFolder = await createFolder(carol, 'Mine');
    await request(app).patch(`/api/v1/files/${fileId}/move`).set(auth(carol)).send({ folderId: carolFolder }).expect(404);
    await request(app).patch(`/api/v1/files/${fileId}/move`).set(auth(carol)).send({ folderId: bobFolder }).expect(404);
    // …nor into an owner folder they cannot write to.
    await request(app).patch(`/api/v1/files/${fileId}/move`).set(auth(carol)).send({ folderId: other }).expect(404);

    const file = await prisma.file.findUnique({ where: { id: fileId } });
    expect(file!.folderId).toBe(shared);
    expect(file!.ownerId).toBe(alice.id);
  });

  it('VIEWER access on a folder is inherited by deeply nested descendants', async () => {
    const top = await createFolder(alice, 'Top');
    const mid = await createFolder(alice, 'Mid', top);
    const deep = await createFolder(alice, 'Deep', mid);
    const fileId = await upload(alice, 'deep.txt', 'deep content', { folderId: deep });

    await request(app).get(`/api/v1/files/${fileId}`).set(auth(bob)).expect(404);
    await share(alice, 'FOLDER', top, bob, 'VIEWER');

    const meta = await request(app).get(`/api/v1/files/${fileId}`).set(auth(bob)).expect(200);
    expect(meta.body.data.permission).toBe('VIEWER');
    await request(app).get(`/api/v1/files/${fileId}/download`).set(auth(bob)).expect(200);
    await request(app).patch(`/api/v1/files/${fileId}/rename`).set(auth(bob)).send({ filename: 'nope.txt' }).expect(403);

    // Revocation removes inherited access immediately.
    await request(app).delete(`/api/v1/sharing/FOLDER/${top}/${bob.id}`).set(auth(alice)).expect(200);
    await request(app).get(`/api/v1/files/${fileId}`).set(auth(bob)).expect(404);
  });

  it('lists root contents for the owner only, and lets collaborators browse shared subfolders', async () => {
    const top = await createFolder(alice, 'Team');
    const child = await createFolder(alice, 'Specs', top);
    const rootFile = await upload(alice, 'root.txt', 'r');
    const childFile = await upload(alice, 'spec.txt', 's', { folderId: child });
    await upload(bob, 'bob-root.txt', 'b');

    const root = await request(app).get('/api/v1/folders/root/contents').set(auth(alice)).expect(200);
    expect(root.body.data.files.map((f: { id: string }) => f.id)).toEqual([rootFile]);
    expect(root.body.data.folders.map((f: { id: string }) => f.id)).toEqual([top]);

    await request(app).get(`/api/v1/folders/${child}/contents`).set(auth(bob)).expect(404);
    await share(alice, 'FOLDER', top, bob, 'VIEWER');

    const sub = await request(app).get(`/api/v1/folders/${child}/contents`).set(auth(bob)).expect(200);
    expect(sub.body.data.permission).toBe('VIEWER');
    expect(sub.body.data.files.map((f: { id: string }) => f.id)).toEqual([childFile]);
    expect(sub.body.data.path.map((p: { name: string }) => p.name)).toEqual(['Team', 'Specs']);

    // Bob's own root never includes Alice's items.
    const bobRoot = await request(app).get('/api/v1/folders/root/contents').set(auth(bob)).expect(200);
    expect(bobRoot.body.data.files.map((f: { filename: string }) => f.filename)).toEqual(['bob-root.txt']);
  });

  it('rejects malformed folder ids', async () => {
    await request(app).get('/api/v1/folders/not-a-uuid/contents').set(auth(alice)).expect(400);
  });

  it('releases quota for every file when a folder is deleted with its contents', async () => {
    const f = await createFolder(alice, 'Big');
    const g = await createFolder(alice, 'Bigger', f);
    await upload(alice, 'a.txt', '1234', { folderId: f });
    await upload(alice, 'b.txt', '123456', { folderId: g });
    const before = (await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes;

    const res = await request(app).delete(`/api/v1/folders/${f}?deleteDescendants=true`).set(auth(alice)).expect(200);
    expect(res.body.data.deletedFiles).toBe(2);
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes).toBe(before - 10n);
  });
});

describe('Sharing permissions', () => {
  it('editors can share but cannot change or revoke the owner’s grants', async () => {
    const fileId = await upload(alice, 'team.txt', 'x');
    await share(alice, 'FILE', fileId, bob, 'EDITOR');
    await share(alice, 'FILE', fileId, carol, 'VIEWER');

    await request(app).delete(`/api/v1/sharing/FILE/${fileId}/${carol.id}`).set(auth(bob)).expect(403);
    await request(app).patch(`/api/v1/sharing/FILE/${fileId}/${carol.id}`).set(auth(bob)).send({ level: 'EDITOR' }).expect(403);
    // Re-sharing with a different level is also a permission change.
    await request(app)
      .post('/api/v1/sharing')
      .set(auth(bob))
      .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: carol.email, level: 'EDITOR' })
      .expect(403);
    // Cannot grant the owner a role on their own item.
    await request(app)
      .post('/api/v1/sharing')
      .set(auth(bob))
      .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: alice.email, level: 'VIEWER' })
      .expect(400);

    const perm = await prisma.permission.findFirst({ where: { resourceId: fileId, granteeUserId: carol.id } });
    expect(perm!.level).toBe('VIEWER');
  });

  it('records distinct share_create / share_update / share_revoke events', async () => {
    const fileId = await upload(alice, 'audit.txt', 'x');
    await share(alice, 'FILE', fileId, bob, 'VIEWER');
    await request(app).patch(`/api/v1/sharing/FILE/${fileId}/${bob.id}`).set(auth(alice)).send({ level: 'EDITOR' }).expect(200);
    await request(app).delete(`/api/v1/sharing/FILE/${fileId}/${bob.id}`).set(auth(alice)).expect(200);

    const events = (await prisma.activityLog.findMany({ where: { resourceId: fileId }, orderBy: { id: 'asc' } })).filter((e) =>
      e.action.startsWith('share')
    );
    expect(events.map((e) => e.action)).toEqual(['share_create', 'share_update', 'share_revoke']);
    expect(events.every((e) => e.targetOwnerId === alice.id)).toBe(true);
  });
});

describe('Activity completeness', () => {
  it('records sign-in, failed sign-in, upload, folder create/rename/move and accurate rename names', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: alice.email, password: 'wrong-password' }).expect(401);
    const a = await createFolder(alice, 'A');
    const b = await createFolder(alice, 'B');
    await request(app).patch(`/api/v1/folders/${b}/rename`).set(auth(alice)).send({ name: 'B2' }).expect(200);
    await request(app).patch(`/api/v1/folders/${b}/move`).set(auth(alice)).send({ parentFolderId: a }).expect(200);
    const fileId = await upload(alice, 'old-name.txt', 'x');
    await request(app).patch(`/api/v1/files/${fileId}/rename`).set(auth(alice)).send({ filename: 'new-name.txt' }).expect(200);

    const logs = await prisma.activityLog.findMany({ where: { userId: alice.id }, orderBy: { id: 'asc' } });
    const actions = logs.map((l) => l.action);
    for (const expected of ['auth_login', 'auth_failed_login', 'folder_create', 'folder_rename', 'folder_move', 'file_upload', 'file_rename']) {
      expect(actions).toContain(expected);
    }
    const rename = logs.find((l) => l.action === 'file_rename')!;
    expect(rename.metadata).toMatchObject({ oldName: 'old-name.txt', newName: 'new-name.txt' });
  });

  it('does not record failed operations as successful', async () => {
    const fileId = await upload(alice, 'x.txt', 'x');
    await request(app).delete(`/api/v1/files/${fileId}`).set(auth(bob)).expect(404);
    await request(app).patch(`/api/v1/files/${fileId}/rename`).set(auth(bob)).send({ filename: 'y.txt' }).expect(404);
    const bogus = await prisma.activityLog.count({ where: { userId: bob.id, action: { in: ['file_delete', 'file_rename'] } } });
    expect(bogus).toBe(0);
  });

  it('logs out with an auth_logout event', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: carol.email, password: 'password123' }).expect(200);
    await request(app).post('/api/v1/auth/logout').send({ tokenFamily: login.body.data.tokens.refreshTokenFamily }).expect(200);
    expect(await prisma.activityLog.count({ where: { userId: carol.id, action: 'auth_logout' } })).toBe(1);
  });
});

describe('Upload failure handling (replaces code-inspection placeholders)', () => {
  it('releases reserved quota when the storage upload fails', async () => {
    const before = (await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes;
    const spy = jest.spyOn(storageService, 'upload').mockRejectedValueOnce(new Error('S3 down'));
    await request(app).post('/api/v1/files').set(auth(alice)).attach('file', Buffer.from('hello'), 'fail.txt').expect(500);
    spy.mockRestore();
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes).toBe(before);
    expect(await prisma.file.count({ where: { ownerId: alice.id, filename: 'fail.txt' } })).toBe(0);
  });

  it('deletes the stored object and releases quota when the database write fails', async () => {
    const before = (await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes;
    const deleteSpy = jest.spyOn(storageService, 'delete');
    const dbSpy = jest.spyOn(fileService, 'createUploadRecord').mockRejectedValueOnce(new Error('DB down'));
    await request(app).post('/api/v1/files').set(auth(alice)).attach('file', Buffer.from('hello'), 'dbfail.txt').expect(500);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    dbSpy.mockRestore();
    deleteSpy.mockRestore();
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.storageUsedBytes).toBe(before);
  });

  it('accepts Markdown uploaded with a generic MIME type and categorizes text as a document', async () => {
    const res = await request(app)
      .post('/api/v1/files')
      .set(auth(alice))
      .attach('file', Buffer.from('# Title\n\nBody'), { filename: 'notes.md', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body.data.mimeType).toBe('text/markdown');
    expect(res.body.data.category).toBe('document');
  });
});

describe('Share-link hardening', () => {
  it('stores a SHA-256 lookup key and still verifies the bcrypt hash', async () => {
    const fileId = await upload(alice, 'link.txt', 'x');
    const created = await request(app).post('/api/v1/share-links/protected').set(auth(alice)).send({ fileId, permission: 'VIEW' }).expect(201);
    const row = await prisma.shareLink.findUnique({ where: { id: created.body.data.id } });
    expect(row!.tokenLookup).toBe(ShareLinkService.lookupKey(created.body.data.token));
    expect(row!.token).toMatch(/^\$2[aby]\$/);
    await request(app).get(`/api/v1/share-links/public/${created.body.data.token}`).expect(200);
  });

  it('still opens legacy bcrypt-only links and backfills their lookup key', async () => {
    const fileId = await upload(alice, 'legacy.txt', 'x');
    const token = randomBytes(32).toString('base64url');
    const link = await prisma.shareLink.create({
      data: { fileId, createdBy: alice.id, token: await bcrypt.hash(token, 4), permission: 'VIEW' },
    });
    await request(app).get(`/api/v1/share-links/public/${token}`).expect(200);
    expect((await prisma.shareLink.findUnique({ where: { id: link.id } }))!.tokenLookup).toBe(ShareLinkService.lookupKey(token));
  });

  it('enforces the download limit atomically under concurrent requests', async () => {
    const fileId = await upload(alice, 'limited.txt', 'x');
    const created = await request(app)
      .post('/api/v1/share-links/protected')
      .set(auth(alice))
      .send({ fileId, permission: 'DOWNLOAD', maxDownloads: 2 })
      .expect(201);
    const token = created.body.data.token;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).get(`/api/v1/share-links/public/${token}/download`))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect((await prisma.shareLink.findUnique({ where: { id: created.body.data.id } }))!.downloadCount).toBe(2);
  });

  it('accepts the password via header and records anonymous access in the owner’s feed', async () => {
    const fileId = await upload(alice, 'pw.txt', 'x');
    const created = await request(app)
      .post('/api/v1/share-links/protected')
      .set(auth(alice))
      .send({ fileId, permission: 'VIEW', password: 'opensesame' })
      .expect(201);
    const token = created.body.data.token;
    await request(app).get(`/api/v1/share-links/public/${token}`).set('X-Share-Password', 'wrong').expect(403);
    await request(app).get(`/api/v1/share-links/public/${token}`).set('X-Share-Password', 'opensesame').expect(200);

    const feed = await request(app).get('/api/v1/activity?action=share_access').set(auth(alice)).expect(200);
    expect(feed.body.data.entries).toHaveLength(1);
    expect(feed.body.data.entries[0].userId).toBeNull();
    expect(feed.body.data.entries[0].anonymous).toBe(true);
    expect(feed.body.data.entries[0].ipAddress).toBeNull();
    // Bob's feed is unaffected.
    const bobFeed = await request(app).get('/api/v1/activity?action=share_access').set(auth(bob)).expect(200);
    expect(bobFeed.body.data.entries).toHaveLength(0);
  });

  it('lets the file owner revoke a link an editor created; viewers cannot list links', async () => {
    const fileId = await upload(alice, 'collab.txt', 'x');
    await share(alice, 'FILE', fileId, bob, 'EDITOR');
    await share(alice, 'FILE', fileId, carol, 'VIEWER');
    const created = await request(app).post('/api/v1/share-links/protected').set(auth(bob)).send({ fileId, permission: 'VIEW' }).expect(201);

    await request(app).get(`/api/v1/share-links/protected/${fileId}`).set(auth(carol)).expect(403);
    await request(app).delete(`/api/v1/share-links/protected/${created.body.data.id}`).set(auth(carol)).expect(403);
    await request(app).delete(`/api/v1/share-links/protected/${created.body.data.id}`).set(auth(alice)).expect(200);
    await request(app).get(`/api/v1/share-links/public/${created.body.data.token}`).expect(403);
  });
});

describe('Health', () => {
  it('reports database, storage and AI subsystem state without secrets', async () => {
    const res = await request(app).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.checks).toMatchObject({ database: 'ok', storage: 'ok' });
    expect(res.body.data.checks.ai).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password|localhost:4566/i);
  });

  it('returns 400 for malformed JSON', async () => {
    await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });
});
