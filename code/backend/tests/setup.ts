import { prisma } from '@/database/prisma';
import { assertDisposableDatabase } from './db-guard';

// BigInt serialization for Jest
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  assertDisposableDatabase(process.env.DATABASE_URL);
  // Final cleanup - delete in correct order to respect foreign key constraints
  await prisma.activityLog.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.file.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// Individual test files should handle their own per-test cleanup
// Global afterEach removed to avoid conflicts with test-specific data management
