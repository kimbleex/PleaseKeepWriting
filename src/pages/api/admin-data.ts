import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser || currentUser.role !== 'ADMIN') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, username: true, role: true, createdAt: true },
  });

  return new Response(
    JSON.stringify({
      currentUserId: currentUser.id,
      users: users.map((user) => ({
        ...user,
        initial: user.username.charAt(0).toUpperCase(),
        createdDate: user.createdAt.toISOString().split('T')[0],
      })),
      totalCount: users.length,
      adminCount: users.filter((user) => user.role === 'ADMIN').length,
      userCount: users.filter((user) => user.role === 'USER').length,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
