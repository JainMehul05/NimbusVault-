import request from 'supertest';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import app from '@app';
import { prisma } from '@/database/prisma';
import { storageService } from '@/common/storage';
import { contentDisposition, firstFreeName, numberedName, sanitizeFilename } from '@/common/names';
import { contentProblem, isInlineSafe } from '@/common/file-signature';
import { uploadService } from '@/modules/files/uploads.service';
import { reconcileQuota } from '@/modules/files/quota.service';
import { trashService } from '@/modules/trash/trash.service';
import { maintenance } from '@/modules/maintenance/maintenance.service';
import { auth, cleanupUsers, createFolder, createUser, share, upload, type TestUser } from './helpers';

const EMAILS = ['p2-alice@example.com', 'p2-bob@example.com'];
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  alice = await createUser(EMAILS[0]);
  bob = await createUser(EMAILS[1]);
});
afterAll(() => cleanupUsers(EMAILS));

const used = async (u: TestUser) => (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).storageUsedBytes;
const begin = (u: TestUser, body: object = {}) =>
  request(app).post('/api/v1/files/presigned-upload').set(auth(u)).send({ filename: 'a.txt', contentType: 'text/plain', sizeBytes: 5, ...body });
const put = (data: { url: string; headers: Record<string, string> }, body: Buffer | string) => fetch(data.url, { method: 'PUT', headers: data.headers, body });
const complete = (u: TestUser, id: string) => request(app).post(`/api/v1/files/${id}/complete`).set(auth(u));
const exists = (key: string) => storageService.getMetadata(key).then(() => true, () => false);

describe('presigned uploads', () => {
  it('reserves quota and a record before issuing a URL, and hides the file until verified', async () => {
    const res = await begin(alice).expect(201);
    expect(await used(alice)).toBe(5n);
    const list = await request(app).get('/api/v1/files').set(auth(alice));
    expect(list.body.data.files).toHaveLength(0);
    await request(app).get(`/api/v1/files/${res.body.data.fileId}/download`).set(auth(alice)).expect(400);
    const early = await complete(alice, res.body.data.fileId).expect(409);
    expect(early.body.error.code).toBe('UPLOAD_INCOMPLETE');

    await put(res.body.data, 'hello');
    const done = await complete(alice, res.body.data.fileId).expect(200);
    expect(done.body.data.checksumSha256).toBe(createHash('sha256').update('hello').digest('hex'));
    expect(await used(alice)).toBe(5n);
    // Completing again is harmless.
    await complete(alice, res.body.data.fileId).expect(200);
    expect(await used(alice)).toBe(5n);
    expect(await prisma.activityLog.count({ where: { userId: alice.id, action: 'file_upload' } })).toBe(1);
  });

  it('cannot be used to exceed the quota, even concurrently', async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { storageQuotaBytes: 100n } });
    const results = await Promise.all(Array.from({ length: 8 }, () => begin(alice, { sizeBytes: 30 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(await used(alice)).toBe(90n);
  });

  it('refuses an object whose size was not declared, deletes it and refunds the quota', async () => {
    const res = await begin(alice, { sizeBytes: 5 });
    // Written straight to storage, as if the signed length had been bypassed.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await s3.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: res.body.data.key, Body: 'much longer than five bytes' }));
    const done = await complete(alice, res.body.data.fileId).expect(400);
    expect(done.body.error.code).toBe('UPLOAD_MISMATCH');
    expect(await used(alice)).toBe(0n);
    expect(await exists(res.body.data.key)).toBe(false);
    expect(await prisma.file.count({ where: { id: res.body.data.fileId } })).toBe(0);
  });

  it('signs the content type and exact length into the URL', async () => {
    const res = await begin(alice);
    const url = new URL(res.body.data.url);
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
  });

  it('cannot alter a finished file by reusing the URL', async () => {
    const res = await begin(alice);
    await put(res.body.data, 'hello');
    await complete(alice, res.body.data.fileId).expect(200);
    await put(res.body.data, 'EVIL!');
    const dl = await request(app).get(`/api/v1/files/${res.body.data.fileId}/download`).set(auth(alice));
    expect(await (await fetch(dl.body.data.downloadUrl)).text()).toBe('hello');
    expect(res.body.data.key.startsWith('staging/')).toBe(true); // covered by the lifecycle rule
  });

  it('verifies a supplied checksum and the content itself', async () => {
    const bad = await begin(alice, { checksumSha256: 'a'.repeat(64) });
    await put(bad.body.data, 'hello');
    expect((await complete(alice, bad.body.data.fileId).expect(400)).body.error.code).toBe('UPLOAD_MISMATCH');

    const exe = await begin(alice, { filename: 'x.png', contentType: 'image/png', sizeBytes: 4 });
    await put(exe.body.data, Buffer.from('MZ\x90\x00', 'latin1'));
    expect((await complete(alice, exe.body.data.fileId).expect(400)).body.error.code).toBe('UNSUPPORTED_TYPE');
    expect(await used(alice)).toBe(0n);
  });

  it('belongs to its initiator only, and can be cancelled exactly once', async () => {
    const res = await begin(alice);
    const id = res.body.data.fileId;
    await put(res.body.data, 'hello');
    await complete(bob, id).expect(404);
    await request(app).delete(`/api/v1/files/${id}/upload`).set(auth(bob)).expect(404);
    const cancels = await Promise.all([1, 2, 3].map(() => request(app).delete(`/api/v1/files/${id}/upload`).set(auth(alice))));
    expect(cancels.some((r) => r.status === 200)).toBe(true);
    expect(await used(alice)).toBe(0n);
    expect(await exists(res.body.data.key)).toBe(false);
    await complete(alice, id).expect(404);
  });

  it('sweeps abandoned reservations and refunds them once', async () => {
    const res = await begin(alice);
    await put(res.body.data, 'hello');
    await prisma.file.update({ where: { id: res.body.data.fileId }, data: { uploadExpiresAt: new Date(Date.now() - 1000) } });
    expect((await complete(alice, res.body.data.fileId)).status).toBe(410);
    const [x, y] = await Promise.all([uploadService.sweepExpired(), uploadService.sweepExpired()]);
    expect(x + y).toBe(1);
    expect(await used(alice)).toBe(0n);
    expect(await exists(res.body.data.key)).toBe(false);
  });

  it('validates input and the target folder', async () => {
    const theirs = await createFolder(bob, 'Private');
    await begin(alice, { folderId: theirs }).expect(404);
    await begin(alice, { sizeBytes: undefined }).expect(400);
    await begin(alice, { sizeBytes: 0 }).expect(400);
    await begin(alice, { sizeBytes: 101 * 1024 * 1024 }).expect(400);
    await begin(alice, { filename: '../../etc/passwd' }).expect(400);
    await begin(alice, { contentType: 'text/html' }).expect(400);
    expect(await used(alice)).toBe(0n);
  });

  it('refunds the reservation when no URL can be issued', async () => {
    const spy = jest.spyOn(storageService, 'generatePresignedUploadUrl').mockRejectedValueOnce(new Error('down'));
    await begin(alice).expect(500);
    spy.mockRestore();
    expect(await used(alice)).toBe(0n);
    expect(await prisma.file.count({ where: { ownerId: alice.id } })).toBe(0);
  });
});

describe('direct uploads', () => {
  const direct = (u: TestUser, body: Buffer | string, filename: string, contentType = 'text/plain', folderId?: string) => {
    const r = request(app).post('/api/v1/files').set(auth(u));
    if (folderId) r.field('folderId', folderId);
    return r.attach('file', Buffer.from(body), { filename, contentType });
  };

  it('numbers duplicate names instead of creating ambiguous files, also concurrently', async () => {
    const res = await Promise.all([1, 2, 3].map(() => direct(alice, 'x', 'report.txt')));
    expect(res.map((r) => r.body.data.filename).sort()).toEqual(['report (1).txt', 'report (2).txt', 'report.txt']);
  });

  it('never lets concurrent uploads exceed the quota', async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { storageQuotaBytes: 250n } });
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => direct(alice, 'x'.repeat(100), `f${i}.txt`)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await used(alice)).toBe(200n);
  });

  it('refuses executables and HTML under a false label, and accepts UTF-8 names', async () => {
    await direct(alice, Buffer.from('MZ\x90\x00', 'latin1'), 'a.png', 'image/png').expect(400);
    await direct(alice, '<!DOCTYPE html><script>alert(1)</script>', 'a.pdf', 'application/pdf').expect(400);
    const ok = await direct(alice, 'x', 'résumé – 履歴書.txt').expect(201);
    expect(ok.body.data.filename).toBe('résumé – 履歴書.txt');
    expect(await used(alice)).toBe(1n);
  });

  it('lets editors add to a shared folder (charged to its owner) but not viewers or strangers', async () => {
    const folder = await createFolder(alice, 'Team');
    await direct(bob, 'x', 'n.txt', 'text/plain', folder).expect(404);
    await share(alice, 'FOLDER', folder, bob, 'VIEWER');
    await direct(bob, 'x', 'n.txt', 'text/plain', folder).expect(403);
    await share(alice, 'FOLDER', folder, bob, 'EDITOR');
    const ok = await direct(bob, 'hello', 'n.txt', 'text/plain', folder).expect(201);
    expect((await prisma.file.findUniqueOrThrow({ where: { id: ok.body.data.id } })).ownerId).toBe(alice.id);
    expect([await used(alice), await used(bob)]).toEqual([5n, 0n]);
    await request(app).delete(`/api/v1/files/${ok.body.data.id}`).set(auth(bob)).expect(403);
  });

  it('always serves downloads with a safe disposition and type', async () => {
    const id = await upload(alice, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', { contentType: 'image/svg+xml' });
    const res = await request(app).get(`/api/v1/files/${id}/download?inline=true`).set(auth(alice)).expect(200);
    const url = new URL(res.body.data.downloadUrl);
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment; filename="logo.svg"/);
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(res.body.data.inline).toBe(false);

    const txt = await upload(alice, 'n.txt', 'x');
    const off = await request(app).get(`/api/v1/files/${txt}/download?inline=false`).set(auth(alice));
    expect(off.body.data.inline).toBe(false);
    const on = await request(app).get(`/api/v1/files/${txt}/download?inline=true`).set(auth(alice));
    expect(new URL(on.body.data.downloadUrl).searchParams.get('response-content-disposition')).toMatch(/^inline/);
  });

  it('treats search wildcards literally and rejects NUL bytes cleanly', async () => {
    await upload(alice, '100% done.txt', 'x');
    await upload(alice, '100 done.txt', 'x');
    const res = await request(app).get('/api/v1/files').query({ search: '100%' }).set(auth(alice));
    expect(res.body.data.files.map((f: { filename: string }) => f.filename)).toEqual(['100% done.txt']);
    expect((await request(app).get('/api/v1/files').query({ search: 'a\u0000b' }).set(auth(alice))).status).toBe(400);
  });
});

describe('folders', () => {
  const rename = (u: TestUser, id: string, name: string) => request(app).patch(`/api/v1/folders/${id}/rename`).set(auth(u)).send({ name });
  const move = (u: TestUser, id: string, parentFolderId: string | null) => request(app).patch(`/api/v1/folders/${id}/move`).set(auth(u)).send({ parentFolderId });
  const create = (u: TestUser, name: string, parentFolderId: string | null = null) => request(app).post('/api/v1/folders').set(auth(u)).send({ name, parentFolderId });

  it('allows a deleted folder’s name to be reused, at the top level and nested', async () => {
    const root = await createFolder(alice, 'Root');
    const nested = await createFolder(alice, 'Docs', root);
    await request(app).delete(`/api/v1/folders/${nested}`).set(auth(alice)).expect(200);
    await create(alice, 'Docs', root).expect(201);
    await create(alice, 'Root').expect(409);
  });

  it('creates exactly one of several simultaneous same-name folders', async () => {
    const statuses = (await Promise.all([1, 2, 3].map(() => create(alice, 'Race')))).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
  });

  it('cannot create a cycle with concurrent moves', async () => {
    const x = await createFolder(alice, 'X');
    const y = await createFolder(alice, 'Y');
    const statuses = (await Promise.all([move(alice, x, y), move(alice, y, x)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400]);
    const tree = await request(app).get('/api/v1/folders/tree').set(auth(alice));
    expect(tree.body.data.tree).toHaveLength(1);
    expect(tree.body.data.tree[0].children).toHaveLength(1);
  });

  it('keeps depths right when a subtree moves, and limits nesting', async () => {
    const a = await createFolder(alice, 'A');
    const b = await createFolder(alice, 'B', a);
    const c = await createFolder(alice, 'C', b);
    await move(alice, b, null).expect(200);
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: c } })).depth).toBe(1);
    await prisma.folder.update({ where: { id: c }, data: { depth: 63 } });
    expect((await create(alice, 'too deep', c).expect(400)).body.error.code).toBe('FOLDER_TOO_DEEP');
  });

  it('validates names', async () => {
    for (const name of ['', '   ', '..', 'a/b', 'a\\b', 'x\u0000y', 'evil\u202Etxt.exe', 'n'.repeat(256)]) await create(alice, name).expect(400);
    const id = await createFolder(alice, 'Fine');
    await rename(alice, id, '  Trimmed  ').expect(200);
    expect((await prisma.folder.findUniqueOrThrow({ where: { id } })).name).toBe('Trimmed');
    await rename(bob, id, 'Stolen').expect(404);
  });
});

describe('trash', () => {
  const trash = (u: TestUser) => request(app).get('/api/v1/trash').set(auth(u)).then((r) => r.body.data.items as Array<{ type: string; id: string; name: string; itemCount?: number }>);

  it('lists, restores and re-charges a file, numbering it if its name was taken', async () => {
    const id = await upload(alice, 'doc.txt', 'hello');
    await request(app).delete(`/api/v1/files/${id}`).set(auth(alice)).expect(200);
    expect(await used(alice)).toBe(0n);
    expect((await trash(alice)).map((i) => i.id)).toEqual([id]);
    expect(await trash(bob)).toEqual([]);
    await request(app).get(`/api/v1/files/${id}/download`).set(auth(alice)).expect(404);

    await upload(alice, 'doc.txt', 'newer');
    await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(bob)).expect(404);
    const res = await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice)).expect(200);
    expect(res.body.data.filename).toBe('doc (1).txt');
    expect(await used(alice)).toBe(10n);
    await request(app).get(`/api/v1/files/${id}/download`).set(auth(alice)).expect(200);
    await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice)).expect(404);
  });

  it('will not restore past the quota, and concurrent restores charge once', async () => {
    const id = await upload(alice, 'doc.txt', 'hello');
    await request(app).delete(`/api/v1/files/${id}`).set(auth(alice));
    await prisma.user.update({ where: { id: alice.id }, data: { storageQuotaBytes: 4n } });
    expect((await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice)).expect(403)).body.error.code).toBe('QUOTA_EXCEEDED');
    await prisma.user.update({ where: { id: alice.id }, data: { storageQuotaBytes: 1000n } });
    await Promise.all([1, 2, 3].map(() => request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice))));
    expect(await used(alice)).toBe(5n);
  });

  it('restores a folder with exactly what was deleted with it', async () => {
    const root = await createFolder(alice, 'Project');
    const sub = await createFolder(alice, 'Sub', root);
    const kept = await upload(alice, 'kept.txt', 'hello', { folderId: sub });
    const earlier = await upload(alice, 'earlier.txt', 'abc', { folderId: root });
    await request(app).delete(`/api/v1/files/${earlier}`).set(auth(alice));
    await request(app).delete(`/api/v1/folders/${root}?deleteDescendants=true`).set(auth(alice)).expect(200);
    expect(await used(alice)).toBe(0n);

    const items = await trash(alice);
    expect(items.map((i) => [i.type, i.name, i.itemCount])).toEqual(expect.arrayContaining([['FOLDER', 'Project', 1], ['FILE', 'earlier.txt', undefined]]));
    expect(items).toHaveLength(2);

    await createFolder(alice, 'Project');
    const res = await request(app).post(`/api/v1/trash/folders/${root}/restore`).set(auth(alice)).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Project (1)', restoredFiles: 1 });
    expect(await used(alice)).toBe(5n);
    await request(app).get(`/api/v1/files/${kept}/download`).set(auth(alice)).expect(200);
    await request(app).get(`/api/v1/files/${earlier}`).set(auth(alice)).expect(404);
  });

  it('permanently deletes the object, record, links and grants — owner only', async () => {
    const id = await upload(alice, 'doc.txt', 'hello');
    await share(alice, 'FILE', id, bob, 'EDITOR');
    await request(app).post('/api/v1/share-links/protected').set(auth(alice)).send({ fileId: id, permission: 'VIEW' }).expect(201);
    const { s3Key } = await prisma.file.findUniqueOrThrow({ where: { id } });
    await request(app).delete(`/api/v1/trash/files/${id}`).set(auth(alice)).expect(404); // not trashed yet
    await request(app).delete(`/api/v1/files/${id}`).set(auth(alice));
    await request(app).delete(`/api/v1/trash/files/${id}`).set(auth(bob)).expect(404);
    await request(app).delete(`/api/v1/trash/files/${id}`).set(auth(alice)).expect(200);
    expect(await exists(s3Key)).toBe(false);
    expect(await prisma.file.count({ where: { id } })).toBe(0);
    expect(await prisma.shareLink.count({ where: { fileId: id } })).toBe(0);
    expect(await prisma.permission.count({ where: { resourceId: id } })).toBe(0);
    expect(await used(alice)).toBe(0n);
  });

  it('keeps the record when storage refuses, so nothing is orphaned and it can be retried', async () => {
    const id = await upload(alice, 'doc.txt', 'hello');
    await request(app).delete(`/api/v1/files/${id}`).set(auth(alice));
    const spy = jest.spyOn(storageService, 'delete').mockRejectedValueOnce(new Error('S3 down'));
    await request(app).delete(`/api/v1/trash/files/${id}`).set(auth(alice)).expect(500);
    spy.mockRestore();
    expect(await prisma.file.count({ where: { id } })).toBe(1);
    await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice)).expect(404); // claimed by the purge
    await request(app).delete(`/api/v1/trash/files/${id}`).set(auth(alice)).expect(200);
  });

  it('empties trash for the caller only and purges expired items', async () => {
    const folder = await createFolder(alice, 'F');
    const inner = await upload(alice, 'inner.txt', 'x', { folderId: folder });
    const loose = await upload(alice, 'loose.txt', 'x');
    const bobs = await upload(bob, 'bob.txt', 'x');
    await request(app).delete(`/api/v1/folders/${folder}?deleteDescendants=true`).set(auth(alice));
    await request(app).delete(`/api/v1/files/${loose}`).set(auth(alice));
    await request(app).delete(`/api/v1/files/${bobs}`).set(auth(bob));
    const res = await request(app).delete('/api/v1/trash').set(auth(alice)).expect(200);
    expect(res.body.data).toEqual({ files: 2, folders: 1 });
    expect(await prisma.file.count({ where: { id: { in: [inner, loose] } } })).toBe(0);
    expect(await prisma.file.count({ where: { id: bobs } })).toBe(1);

    expect(await trashService.purgeExpired(30)).toBe(0);
    await prisma.file.update({ where: { id: bobs }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await trashService.purgeExpired(30)).toBe(1);
  });
});

describe('maintenance', () => {
  it('corrects storage drift for idle accounts only', async () => {
    await upload(alice, 'x.txt', 'hello');
    await prisma.user.update({ where: { id: alice.id }, data: { storageUsedBytes: 999n } });
    await reconcileQuota();
    expect(await used(alice)).toBe(999n); // changed moments ago
    await prisma.$executeRaw`UPDATE "users" SET "updatedAt" = "updatedAt" - INTERVAL '2 hours' WHERE "id" = ${alice.id}`;
    await reconcileQuota();
    expect(await used(alice)).toBe(5n);
  });

  it('runs every task without failing', async () => {
    await expect(maintenance.runOnce()).resolves.toBeUndefined();
  });

  it('cannot store negative usage', async () => {
    await expect(prisma.user.update({ where: { id: alice.id }, data: { storageUsedBytes: -1n } })).rejects.toThrow();
  });
});

describe('name and content helpers', () => {
  it('sanitizes, numbers and encodes names', () => {
    expect(sanitizeFilename('C:\\fake\\..\\path\\a.txt')).toBe('a.txt');
    expect(sanitizeFilename('..')).toBe('untitled');
    expect(sanitizeFilename('a\u202E\u0000b.txt')).toBe('ab.txt');
    expect(sanitizeFilename(`${'x'.repeat(300)}.pdf`)).toHaveLength(255);
    expect(numberedName('archive.tar', 2)).toBe('archive (2).tar');
    expect(numberedName('.env', 1)).toBe('.env (1)');
    expect(firstFreeName('a.txt', new Set(['a.txt', 'a (1).txt']))).toBe('a (2).txt');
    const cd = contentDisposition('attachment', 'a"\r\nX: 1 é.txt');
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).toContain("filename*=UTF-8''a%22%0D%0AX%3A%201%20%C3%A9.txt");
  });

  it('classifies dangerous and safe content', () => {
    expect(contentProblem(Buffer.from('#!/bin/sh\n'), 'text/plain')).not.toBeNull();
    expect(contentProblem(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'application/pdf')).not.toBeNull();
    expect(contentProblem(Buffer.from('%PDF-1.7'), 'application/pdf')).toBeNull();
    expect(contentProblem(Buffer.from('<h1>markdown may contain html</h1>'), 'text/markdown')).toBeNull();
    expect(contentProblem(Buffer.from('\ufeffhello', 'utf16le'), 'text/plain')).toBeNull();
    expect([isInlineSafe('image/png'), isInlineSafe('image/svg+xml'), isInlineSafe('text/html')]).toEqual([true, false, false]);
  });

  it('generates unguessable keys that never contain the user’s path', () => {
    const key = storageService.generateObjectKey('u1', '../../x.p/h p');
    expect(key).toMatch(/^u1\/\d+-[0-9a-f]{32}$/);
    expect(storageService.generateObjectKey('u1', 'A.PDF')).toMatch(/\.pdf$/);
  });
});
