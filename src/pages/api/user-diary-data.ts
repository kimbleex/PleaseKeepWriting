import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const targetUserId = url.searchParams.get('id');
  if (!targetUserId || targetUserId === currentUser.id) {
    return new Response(JSON.stringify({ error: 'Invalid user' }), { status: 400 });
  }

  const [targetUser, permission] = await Promise.all([
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true },
    }),
    prisma.permissionRequest.findFirst({
      where: {
        requesterId: currentUser.id,
        targetId: targetUserId,
        status: 'APPROVED',
      },
      select: { id: true },
    }),
  ]);

  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  if (!permission && currentUser.role !== 'ADMIN') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const diaries = await prisma.diary.findMany({
    where: { userId: targetUserId },
    orderBy: { date: 'desc' },
    select: { id: true, date: true, content: true },
  });

  return new Response(
    JSON.stringify({
      user: targetUser,
      diaries: diaries.map((diary) => ({
        id: diary.id,
        dateStr: diary.date.toISOString().split('T')[0],
        content: diary.content,
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
