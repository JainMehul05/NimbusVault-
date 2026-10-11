import request from 'supertest';
import app from '@app';
import { prisma } from '@/database/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '@/config/index';

describe('Health API', () => {
  it('GET /api/v1/health should return success', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('NimbusVault backend running');
  });
});

describe('Authentication', () => {
  const testUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
  };

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.user.name).toBe(testUser.name);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
      expect(response.body.data.tokens.refreshTokenFamily).toBeDefined();
    });

    it('should fail with duplicate email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('should fail with invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...testUser, email: 'invalid-email' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should fail with short password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...testUser, password: 'short' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
      await prisma.user.create({
        data: {
          name: testUser.name,
          email: testUser.email,
          passwordHash,
        },
      });
    });

    it('should login successfully with correct credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should fail with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should fail with non-existent user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'password123' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('JWT Protected Routes', () => {
    let accessToken: string;
    let refreshToken: string;
    let tokenFamily: string;

    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
      const user = await prisma.user.create({
        data: {
          name: testUser.name,
          email: testUser.email,
          passwordHash,
        },
      });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      accessToken = loginResponse.body.data.tokens.accessToken;
      refreshToken = loginResponse.body.data.tokens.refreshToken;
      tokenFamily = loginResponse.body.data.tokens.refreshTokenFamily;
    });

    it('should access /auth/me with valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe(testUser.email);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOKEN_REQUIRED');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Refresh Token Rotation', () => {
    let refreshToken: string;
    let tokenFamily: string;

    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
      await prisma.user.create({
        data: {
          name: testUser.name,
          email: testUser.email,
          passwordHash,
        },
      });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      refreshToken = loginResponse.body.data.tokens.refreshToken;
      tokenFamily = loginResponse.body.data.tokens.refreshTokenFamily;
    });

    it('should rotate refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, tokenFamily })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
      expect(response.body.data.refreshTokenFamily).toBe(tokenFamily);
    });

    it('should detect token reuse', async () => {
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, tokenFamily })
        .expect(200);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, tokenFamily })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    let tokenFamily: string;

    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
      await prisma.user.create({
        data: {
          name: testUser.name,
          email: testUser.email,
          passwordHash,
        },
      });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      tokenFamily = loginResponse.body.data.tokens.refreshTokenFamily;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({ tokenFamily })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should invalidate refresh tokens after logout', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const refreshToken = loginResponse.body.data.tokens.refreshToken;
      const newTokenFamily = loginResponse.body.data.tokens.refreshTokenFamily;

      await request(app)
        .post('/api/v1/auth/logout')
        .send({ tokenFamily: newTokenFamily })
        .expect(200);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, tokenFamily: newTokenFamily })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});