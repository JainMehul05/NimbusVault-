import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

import { PrismaClient } from '@prisma/client';
import { prisma } from '@/database/prisma';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  // Delete in correct order to respect foreign key constraints
  await prisma.file.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});