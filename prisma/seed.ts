import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminExists = await prisma.user.findFirst({
    where: { role: 'ADMIN' }
  });

  if (adminExists) {
    console.log('Admin user already exists!');
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN'
    }
  });

  console.log(`Created admin user: ${admin.username} / admin123`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
