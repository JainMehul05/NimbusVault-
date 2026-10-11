import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});