import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { attachDatabasePool } from '@vercel/functions';

const connectionString = (import.meta.env ? import.meta.env.DATABASE_URL : process.env.DATABASE_URL);

if (!connectionString) {
  console.warn('DATABASE_URL is not defined. Prisma might fail to connect.');
}

const pool = new Pool({ connectionString });
attachDatabasePool(pool);
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
