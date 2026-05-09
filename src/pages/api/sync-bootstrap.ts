import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const [me, myDiaries, allUserList, teamDiaryRows, permissions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, role: true, createdAt: true },
    }),
    prisma.diary.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, content: true, createdAt: true, updatedAt: true },
    }),
    prisma.user.findMany({ where: { role: 'USER' }, select: { id: true } }),
    prisma.diary.findMany({
      select: { date: true, userId: true },
    }),
    prisma.permissionRequest.findMany({
      where: {
        OR: [{ requesterId: user.id }, { targetId: user.id }],
      },
      select: { requesterId: true, targetId: true, status: true },
    }),
  ]);

  if (!me) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  const userSet = new Set(allUserList.map((u) => u.id));
  const teamDiaryDays = teamDiaryRows
    .filter((row) => userSet.has(row.userId))
    .map((row) => ({
      dateStr: row.date.toISOString().split('T')[0],
      userId: row.userId,
    }));

  return new Response(
    JSON.stringify({
      user: {
        id: me.id,
        username: me.username,
        role: me.role,
        createdAt: me.createdAt.toISOString(),
      },
      totalUsers: allUserList.length,
      myDiaries: myDiaries.map((d) => ({
        id: d.id,
        dateStr: d.date.toISOString().split('T')[0],
        content: d.content,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      teamDiaryDays,
      permissions,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
