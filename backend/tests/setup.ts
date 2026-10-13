import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

import { PrismaClient } from '@prisma/client';
import { prisma } from '@/database/prisma';

// BigInt serialization for Jest
(BigInt.prototype as any).toJSON = function() {
  return this.toString();
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  // Final cleanup
  await prisma.file.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// Individual test files should handle their own per-test cleanup
// Global afterEach removed to avoid conflicts with test-specific data management