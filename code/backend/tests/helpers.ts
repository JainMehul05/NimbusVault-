import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '@app';
import { prisma } from '@/database/prisma';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

/** Removes every row belonging to the given test accounts (children first). */
export async function cleanupUsers(emails: string[]): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.activityLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { targetOwnerId: { in: ids } }] } });
  await prisma.shareLink.deleteMany({ where: { OR: [{ createdBy: { in: ids } }, { file: { ownerId: { in: ids } } }] } });
  await prisma.permission.deleteMany({ where: { OR: [{ granteeUserId: { in: ids } }, { grantedBy: { in: ids } }] } });
  await prisma.file.deleteMany({ where: { ownerId: { in: ids } } }); // cascades AI rows
  await prisma.folder.deleteMany({ where: { ownerId: { in: ids }, parentFolderId: { not: null } } });
  await prisma.folder.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function createUser(email: string, name = email.split('@')[0]): Promise<TestUser> {
  const password = 'password123';
  const user = await prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 4) },
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (login.status !== 200) throw new Error(`login failed for ${email}: ${login.status}`);
  return { id: user.id, email, name, token: login.body.data.tokens.accessToken };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

export async function upload(
  u: TestUser,
  filename: string,
  content: string | Buffer,
  opts: { folderId?: string; contentType?: string } = {}
): Promise<string> {
  const req = request(app).post('/api/v1/files').set(auth(u));
  if (opts.folderId) req.field('folderId', opts.folderId);
  const res = await req.attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), {
    filename,
    contentType: opts.contentType ?? 'text/plain',
  });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function createFolder(u: TestUser, name: string, parentFolderId: string | null = null): Promise<string> {
  const res = await request(app).post('/api/v1/folders').set(auth(u)).send({ name, parentFolderId });
  if (res.status !== 201) throw new Error(`folder failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function share(owner: TestUser, resourceType: 'FILE' | 'FOLDER', resourceId: string, grantee: TestUser, level: 'VIEWER' | 'EDITOR') {
  const res = await request(app)
    .post('/api/v1/sharing')
    .set(auth(owner))
    .send({ resourceType, resourceId, granteeEmail: grantee.email, level });
  if (res.status !== 201) throw new Error(`share failed: ${res.status} ${JSON.stringify(res.body)}`);
}
