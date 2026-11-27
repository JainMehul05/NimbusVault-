import { Prisma } from '@prisma/client';
import type { PrismaClient, User } from '@prisma/client';
import { AppError } from '@common/errors';
import prisma from '@database/prisma';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const toSafeUser = (user: User): SafeUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const emailTaken = () => AppError.conflict('Email already registered', 'EMAIL_EXISTS');

export class UserService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async create(input: CreateUserInput): Promise<SafeUser> {
    if (await this.findByEmail(input.email)) throw emailTaken();
    try {
      const user = await this.prismaClient.user.create({
        data: { name: input.name, email: input.email.toLowerCase(), passwordHash: input.passwordHash },
      });
      return toSafeUser(user);
    } catch (error) {
      // Two simultaneous registrations: the database constraint decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw emailTaken();
      throw error;
    }
  }

  /** Case-insensitive. New accounts are stored in lower case; older rows may not be. */
  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const exact = await this.prismaClient.user.findUnique({ where: { email: normalized } });
    if (exact) return exact;
    const rows = await this.prismaClient.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "users" WHERE lower("email") = ${normalized} ORDER BY "createdAt" LIMIT 1`;
    return rows[0] ? this.prismaClient.user.findUnique({ where: { id: rows[0].id } }) : null;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.prismaClient.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.prismaClient.user.findUnique({ where: { id } });
    return user ? toSafeUser(user) : null;
  }
}

export const userService = new UserService();
