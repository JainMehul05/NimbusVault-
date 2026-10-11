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
  createdAt: Date;
  updatedAt: Date;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async create(input: CreateUserInput): Promise<SafeUser> {
    const existingUser = await this.prismaClient.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw AppError.conflict('Email already registered', 'EMAIL_EXISTS');
    }

    const user = await this.prismaClient.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
      },
    });

    return toSafeUser(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prismaClient.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.prismaClient.user.findUnique({
      where: { id },
    });

    if (!user) return null;

    return toSafeUser(user);
  }
}

export const userService = new UserService();