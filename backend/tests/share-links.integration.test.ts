import request from 'supertest';
import app from '@app';
import { prisma } from '@/database/prisma';
import bcrypt from 'bcrypt';
import { config } from '@/config/index';
import { randomBytes } from 'crypto';

describe('Share Links Integration Tests', () => {
  const testUser = {
    name: 'Test User',
    email: 'sharelink-test@example.com',
    password: 'password123',
  };

  const testUser2 = {
    name: 'Test User 2',
    email: 'sharelink-test2@example.com',
    password: 'password123',
  };

  let userAccessToken: string;
  let userId: string;
  let fileId: string;
  let fileId2: string;

  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
    await prisma.userSession.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
  });

  beforeEach(async () => {
    // Clean up users first (they persist between tests in this describe block)
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
    await prisma.userSession.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });

    // Clean up share links and files for each test
    await prisma.shareLink.deleteMany({ where: { file: { owner: { email: testUser.email } } } });
    await prisma.file.deleteMany({ where: { owner: { email: testUser.email } } });
    await prisma.folder.deleteMany({ where: { owner: { email: testUser.email } } });

    // Create test user
    const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
    const user = await prisma.user.create({
      data: {
        name: testUser.name,
        email: testUser.email,
        passwordHash,
      },
    });
    userId = user.id;

    // Create test user 2
    const passwordHash2 = await bcrypt.hash(testUser2.password, config.bcrypt.rounds);
    await prisma.user.create({
      data: {
        name: testUser2.name,
        email: testUser2.email,
        passwordHash: passwordHash2,
      },
    });

    // Login user
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    userAccessToken = loginResponse.body.data.tokens.accessToken;

    // Upload a test file
    const fileContent = Buffer.from('Share link test content');
    const uploadResponse = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .attach('file', fileContent, 'share-test.txt');
    fileId = uploadResponse.body.data.id;

    // Upload a second file for additional tests
    const uploadResponse2 = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .attach('file', Buffer.from('Second file'), 'share-test2.txt');
    fileId2 = uploadResponse2.body.data.id;
  });

  afterAll(async () => {
    await prisma.shareLink.deleteMany({ where: { file: { owner: { email: testUser.email } } } });
    await prisma.file.deleteMany({ where: { owner: { email: testUser.email } } });
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/share-links/protected - Create Share Link', () => {
    it('should create a share link with VIEW permission', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.token.length).toBeGreaterThan(0);
      expect(response.body.data.permission).toBe('VIEW');
      expect(response.body.data.url).toContain('/share/');
      expect(response.body.data.id).toBeDefined();
    });

    it('should create a share link with DOWNLOAD permission', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.permission).toBe('DOWNLOAD');
    });

    it('should create a password-protected share link', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', password: 'secret123' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
    });

    it('should create a share link with expiry', async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', expiresAt })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.expiresAt).toBeDefined();
    });

    it('should create a share link with maxDownloads', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD', maxDownloads: 5 })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.maxDownloads).toBe(5);
    });

    it('should reject creation for non-existent file', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId: '00000000-0000-0000-0000-000000000000', permission: 'VIEW' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FILE_NOT_FOUND');
    });

    it('should reject creation by non-owner', async () => {
      // Login as user2
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser2.email, password: testUser2.password });
      const user2Token = loginResponse.body.data.tokens.accessToken;

      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ fileId, permission: 'VIEW' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FILE_NOT_FOUND');
    });

    it('should reject without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .send({ fileId, permission: 'VIEW' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should validate permission enum', async () => {
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'INVALID' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/share-links/protected/:fileId - List Share Links', () => {
    let shareLinkId: string;

    beforeEach(async () => {
      // Create a share link for testing
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });
      shareLinkId = createResponse.body.data.id;
    });

    it('should list share links for a file', async () => {
      const response = await request(app)
        .get(`/api/v1/share-links/protected/${fileId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shareLinks).toHaveLength(1);
      expect(response.body.data.shareLinks[0].id).toBe(shareLinkId);
      expect(response.body.data.shareLinks[0].permission).toBe('VIEW');
      // Token should not be exposed in list view
      expect(response.body.data.shareLinks[0].token).toBeUndefined();
    });

    it('should return empty list for file with no share links', async () => {
      const response = await request(app)
        .get(`/api/v1/share-links/protected/${fileId2}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shareLinks).toHaveLength(0);
    });

    it('should reject access by non-owner', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser2.email, password: testUser2.password });
      const user2Token = loginResponse.body.data.tokens.accessToken;

      const response = await request(app)
        .get(`/api/v1/share-links/protected/${fileId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FILE_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/share-links/protected/:shareLinkId - Revoke Share Link', () => {
    let shareLinkId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });
      shareLinkId = createResponse.body.data.id;
    });

    it('should revoke a share link', async () => {
      const response = await request(app)
        .delete(`/api/v1/share-links/protected/${shareLinkId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Share link revoked successfully');

      // Verify it's revoked in database
      const shareLink = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
      expect(shareLink!.revokedAt).not.toBeNull();
    });

    it('should reject revocation by non-owner', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser2.email, password: testUser2.password });
      const user2Token = loginResponse.body.data.tokens.accessToken;

      const response = await request(app)
        .delete(`/api/v1/share-links/protected/${shareLinkId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject revocation of already revoked link', async () => {
      await request(app)
        .delete(`/api/v1/share-links/protected/${shareLinkId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      const response = await request(app)
        .delete(`/api/v1/share-links/protected/${shareLinkId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/share-links/public/:token - Access Share Link (Public)', () => {
    it('should access a share link with valid token', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.file.id).toBe(fileId);
      expect(response.body.data.file.filename).toBe('share-test.txt');
      expect(response.body.data.permission).toBe('VIEW');
      expect(response.body.data.requiresPassword).toBe(false);
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/share-links/public/invalid-token')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SHARE_NOT_FOUND');
    });

    it('should reject revoked share link', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const token = createResponse.body.data.token;

      await request(app)
        .delete(`/api/v1/share-links/protected/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SHARE_REVOKED');
    });

    it('should reject expired share link', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString(); // Expired 1 second ago
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', expiresAt });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SHARE_EXPIRED');
    });

    it('should require password for password-protected link', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', password: 'secret123' });

      const token = createResponse.body.data.token;

      // Without password
      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PASSWORD_REQUIRED');
    });

    it('should accept correct password for password-protected link', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', password: 'secret123' });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}?password=secret123`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.file.id).toBe(fileId);
    });

    it('should reject incorrect password', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', password: 'secret123' });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}?password=wrong`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PASSWORD');
    });

    it('should enforce download limit', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD', maxDownloads: 1 });

      const token = createResponse.body.data.token;

      // First download should work
      await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(200);

      // Second download should fail
      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SHARE_EXHAUSTED');
    });
  });

  describe('GET /api/v1/share-links/public/:token/download - Download via Share Link', () => {
    it('should generate presigned download URL for DOWNLOAD permission', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD' });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.downloadUrl).toBeDefined();
      expect(response.body.data.downloadUrl).toContain('localhost:4566');
      expect(response.body.data.expiresIn).toBe(3600);
      expect(response.body.data.filename).toBe('share-test.txt');
    });

    it('should reject download for VIEW-only permission', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const token = createResponse.body.data.token;

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should increment download count on download', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD' });

      const token = createResponse.body.data.token;

      await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(200);

      const shareLinkById = await prisma.shareLink.findUnique({ where: { id: createResponse.body.data.id } });
      expect(shareLinkById!.downloadCount).toBe(1);
    });
  });

  describe('Token Storage Security', () => {
    it('should store token as bcrypt hash, not plaintext', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const token = createResponse.body.data.token;
      const shareLinkId = createResponse.body.data.id;

      const shareLink = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
      
      // Token should be a bcrypt hash (starts with $2b$)
      expect(shareLink!.token).toMatch(/^\$2[aby]\$\d+\$/);
      expect(shareLink!.token).not.toBe(token);
      
      // Should be verifiable with bcrypt
      const isValid = await bcrypt.compare(token, shareLink!.token);
      expect(isValid).toBe(true);
    });

    it('should not accept plaintext token for verification', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const shareLinkId = createResponse.body.data.id;
      const shareLink = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
      const tokenHash = shareLink!.token;

      // The plaintext token should NOT match the stored hash directly
      const isPlaintextMatch = tokenHash === createResponse.body.data.token;
      expect(isPlaintextMatch).toBe(false);
    });

    it('should store password as bcrypt hash', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW', password: 'secret123' });

      const shareLinkId = createResponse.body.data.id;
      const shareLink = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
      
      // Password hash should be bcrypt
      expect(shareLink!.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
      
      // Should be verifiable with bcrypt
      const isValid = await bcrypt.compare('secret123', shareLink!.passwordHash!);
      expect(isValid).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit on public share link access', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'VIEW' });

      const token = createResponse.body.data.token;

      // Make 20 requests (the limit)
      for (let i = 0; i < 20; i++) {
        await request(app).get(`/api/v1/share-links/public/${token}`);
      }

      // 21st request should be rate limited
      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}`)
        .expect(429);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    }, 60000);

    it('should enforce rate limit on download endpoint', async () => {
      const createResponse = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ fileId, permission: 'DOWNLOAD' });

      const token = createResponse.body.data.token;

      for (let i = 0; i < 20; i++) {
        await request(app).get(`/api/v1/share-links/public/${token}/download`);
      }

      const response = await request(app)
        .get(`/api/v1/share-links/public/${token}/download`)
        .expect(429);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    }, 60000);
  });

  describe('Migration: Legacy Plaintext Tokens', () => {
    it('should reject legacy plaintext tokens (no fallback)', async () => {
      // Manually create a share link with plaintext token (simulating legacy data)
      const plaintextToken = randomBytes(32).toString('base64url');
      const file = await prisma.file.findUnique({ where: { id: fileId } });
      
      await prisma.shareLink.create({
        data: {
          fileId: file!.id,
          createdBy: userId,
          token: plaintextToken, // Plaintext - legacy format
          permission: 'VIEW',
          passwordHash: null,
          expiresAt: new Date(Date.now() + 86400000),
          maxDownloads: null,
        },
      });

      // Attempting to access with the plaintext token should fail
      const response = await request(app)
        .get(`/api/v1/share-links/public/${plaintextToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SHARE_NOT_FOUND');
    });
  });
});

describe('Share Links - Permission Inheritance and EDITOR Sharing', () => {
  const testUser = {
    name: 'Share Test User',
    email: 'share-perm-test-inherit@example.com',
    password: 'password123',
  };

  const testUser2 = {
    name: 'Share Test User 2',
    email: 'share-perm-test2-inherit@example.com',
    password: 'password123',
  };

  let userAccessToken: string;
  let userId: string;
  let user2AccessToken: string;
  let user2Id: string;
  let fileId: string;
  let folderId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
    await prisma.userSession.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
  });

  beforeEach(async () => {
    // Clean up users first (they persist between tests in this describe block)
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });
    await prisma.userSession.deleteMany({ where: { user: { email: { in: [testUser.email, testUser2.email] } } } });

    // Clean up permissions first (need file/folder IDs)
    const userFiles = await prisma.file.findMany({ where: { owner: { email: testUser.email } }, select: { id: true } });
    const userFileIds = userFiles.map(f => f.id);
    if (userFileIds.length > 0) {
      await prisma.permission.deleteMany({ where: { resourceType: 'FILE', resourceId: { in: userFileIds } } });
    }

    const userFolders = await prisma.folder.findMany({ where: { owner: { email: testUser.email } }, select: { id: true } });
    const userFolderIds = userFolders.map(f => f.id);
    if (userFolderIds.length > 0) {
      await prisma.permission.deleteMany({ where: { resourceType: 'FOLDER', resourceId: { in: userFolderIds } } });
    }

    await prisma.shareLink.deleteMany({ where: { file: { owner: { email: testUser.email } } } });
    await prisma.file.deleteMany({ where: { owner: { email: testUser.email } } });
    await prisma.folder.deleteMany({ where: { owner: { email: testUser.email } } });

    const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
    const user = await prisma.user.create({
      data: { name: testUser.name, email: testUser.email, passwordHash },
    });
    userId = user.id;

    const passwordHash2 = await bcrypt.hash(testUser2.password, config.bcrypt.rounds);
    const user2 = await prisma.user.create({
      data: { name: testUser2.name, email: testUser2.email, passwordHash: passwordHash2 },
    });
    user2Id = user2.id;

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    userAccessToken = loginResponse.body.data.tokens.accessToken;

    const loginResponse2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser2.email, password: testUser2.password });
    user2AccessToken = loginResponse2.body.data.tokens.accessToken;

    // Create a folder
    const folderResponse = await request(app)
      .post('/api/v1/folders')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .send({ name: 'Test Folder', parentFolderId: null });
    folderId = folderResponse.body.data.id;

    // Upload a file in the folder
    const fileResponse = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${userAccessToken}`)
      .attach('file', Buffer.from('Permission test'), 'perm-test.txt')
      .field('folderId', folderId);
    fileId = fileResponse.body.data.id;
  });

  afterAll(async () => {
    await prisma.permission.deleteMany({ where: { granteeUserId: { in: [userId, user2Id] } } });
    await prisma.shareLink.deleteMany({ where: { file: { owner: { email: testUser.email } } } });
    await prisma.file.deleteMany({ where: { owner: { email: testUser.email } } });
    await prisma.folder.deleteMany({ where: { owner: { email: testUser.email } } });
    await prisma.user.deleteMany({ where: { email: { in: [testUser.email, testUser2.email] } } });
    await prisma.$disconnect();
  });

  describe('Permission Inheritance (Folder -> File)', () => {
    it('should grant VIEWER access to file via folder VIEWER permission', async () => {
      // Share folder with VIEWER permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FOLDER', resourceId: folderId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // User2 should be able to access the file in the folder
      const response = await request(app)
        .get(`/api/v1/files/${fileId}`)
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(fileId);
    });

    it('should grant EDITOR access to file via folder EDITOR permission', async () => {
      // Share folder with EDITOR permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FOLDER', resourceId: folderId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      // User2 should be able to rename the file (EDITOR action)
      const response = await request(app)
        .patch(`/api/v1/files/${fileId}/rename`)
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ filename: 'renamed-by-editor.txt' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.filename).toBe('renamed-by-editor.txt');
    });

    it('should NOT allow VIEWER to perform EDITOR actions on inherited file', async () => {
      // Share folder with VIEWER permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FOLDER', resourceId: folderId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // User2 should NOT be able to rename the file
      const response = await request(app)
        .patch(`/api/v1/files/${fileId}/rename`)
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ filename: 'renamed-by-viewer.txt' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should grant access to nested folder files', async () => {
      // Create nested folder
      const childFolderResponse = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ name: 'Child Folder', parentFolderId: folderId });
      const childFolderId = childFolderResponse.body.data.id;

      // Upload file in child folder
      const childFileResponse = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .attach('file', Buffer.from('Child file'), 'child.txt')
        .field('folderId', childFolderId);
      const childFileId = childFileResponse.body.data.id;

      // Share parent folder with VIEWER
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FOLDER', resourceId: folderId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // User2 should access file in nested folder
      const response = await request(app)
        .get(`/api/v1/files/${childFileId}`)
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('EDITOR Sharing Permissions', () => {
    it('should allow EDITOR to share file with others', async () => {
      // Share file directly with EDITOR permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      // User2 (EDITOR) should be able to share the file with a third user
      // First create a third user
      const testUser3 = { name: 'User 3', email: 'user3@example.com', password: 'password123' };
      await prisma.user.deleteMany({ where: { email: testUser3.email } });
      const passwordHash3 = await bcrypt.hash(testUser3.password, config.bcrypt.rounds);
      await prisma.user.create({ data: { name: testUser3.name, email: testUser3.email, passwordHash: passwordHash3 } });

      const loginResponse3 = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser3.email, password: testUser3.password });
      const user3Token = loginResponse3.body.data.tokens.accessToken;

      // User2 shares with User3
      const shareResponse = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser3.email, level: 'VIEWER' })
        .expect(201);

      expect(shareResponse.body.success).toBe(true);

      // Cleanup
      await prisma.user.deleteMany({ where: { email: testUser3.email } });
    });

    it('should allow EDITOR to create share links', async () => {
      // Share file directly with EDITOR permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      // User2 (EDITOR) should be able to create a share link
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ fileId, permission: 'VIEW' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
    });

    it('should NOT allow VIEWER to create share links', async () => {
      // Share file directly with VIEWER permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // User2 (VIEWER) should NOT be able to create a share link
      const response = await request(app)
        .post('/api/v1/share-links/protected')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ fileId, permission: 'VIEW' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should NOT allow VIEWER to share with others', async () => {
      // Share file directly with VIEWER permission
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // Create third user
      const testUser3 = { name: 'User 3', email: 'user3@example.com', password: 'password123' };
      await prisma.user.deleteMany({ where: { email: testUser3.email } });
      const passwordHash3 = await bcrypt.hash(testUser3.password, config.bcrypt.rounds);
      await prisma.user.create({ data: { name: testUser3.name, email: testUser3.email, passwordHash: passwordHash3 } });

      // User2 (VIEWER) tries to share with User3
      const response = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser3.email, level: 'VIEWER' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');

      // Cleanup
      await prisma.user.deleteMany({ where: { email: testUser3.email } });
    });
  });

  describe('Sharing CRUD Operations', () => {
    it('should create a direct file share', async () => {
      const response = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.permission.level).toBe('VIEWER');
      expect(response.body.data.grantee.email).toBe(testUser2.email);
    });

    it('should update an existing share', async () => {
      // Create share
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      // Update to EDITOR
      const response = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.permission.level).toBe('EDITOR');
    });

    it('should list shares for a file', async () => {
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      const response = await request(app)
        .get(`/api/v1/sharing/FILE/${fileId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shares).toHaveLength(1);
      expect(response.body.data.shares[0].grantee.email).toBe(testUser2.email);
      expect(response.body.data.shares[0].level).toBe('VIEWER');
    });

    it('should revoke a share', async () => {
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'VIEWER' })
        .expect(201);

      const response = await request(app)
        .delete(`/api/v1/sharing/FILE/${fileId}/${user2Id}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify revoked
      const listResponse = await request(app)
        .get(`/api/v1/sharing/FILE/${fileId}`)
        .set('Authorization', `Bearer ${userAccessToken}`)
        .expect(200);

      expect(listResponse.body.data.shares).toHaveLength(0);
    });

    it('should reject share creation for non-existent user', async () => {
      const response = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: 'nonexistent@example.com', level: 'VIEWER' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_OWNER');
    });

    it('should reject self-sharing', async () => {
      const response = await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser.email, level: 'VIEWER' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listResourcesSharedWithUser - Permission Levels', () => {
    it('should return correct permission level for direct file share', async () => {
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FILE', resourceId: fileId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      const response = await request(app)
        .get('/api/v1/sharing/me/shared-with-me?page=1&limit=20')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const file = response.body.data.files.find((f: any) => f.id === fileId);
      expect(file).toBeDefined();
      expect(file.permission).toBe('EDITOR');
    });

    it('should return correct inherited permission level from folder', async () => {
      // Share folder with EDITOR
      await request(app)
        .post('/api/v1/sharing')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ resourceType: 'FOLDER', resourceId: folderId, granteeEmail: testUser2.email, level: 'EDITOR' })
        .expect(201);

      const response = await request(app)
        .get('/api/v1/sharing/me/shared-with-me?page=1&limit=20')
        .set('Authorization', `Bearer ${user2AccessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const file = response.body.data.files.find((f: any) => f.id === fileId);
      expect(file).toBeDefined();
      // Inherited permission should match folder permission (EDITOR)
      expect(file.permission).toBe('EDITOR');
    });
  });
});