import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const [me, myDiaries, allUserList, adminUserList, teamDiaryRows, permissions, announcements] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, role: true, createdAt: true },
    }),
    prisma.diary.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, content: true, createdAt: true, updatedAt: true },
    }),
    prisma.user.findMany({
      where: { role: 'USER' },
      orderBy: [{ createdAt: 'asc' }, { username: 'asc' }],
      select: { id: true, username: true, role: true, createdAt: true }
    }),
    user.role === 'ADMIN'
      ? prisma.user.findMany({
          orderBy: [{ createdAt: 'desc' }, { username: 'asc' }],
          select: { id: true, username: true, role: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.diary.findMany({
      select: { date: true, userId: true },
    }),
    prisma.permissionRequest.findMany({
      where: {
        OR: [{ requesterId: user.id }, { targetId: user.id }],
      },
      select: { id: true, requesterId: true, targetId: true, status: true, updatedAt: true },
    }),
    prisma.announcement.findMany({
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        title: true,
        tag: true,
        summary: true,
        body: true,
        pinned: true,
        publishedAt: true,
        readUserIds: true,
        createdAt: true,
        updatedAt: true,
      },
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
      users: allUserList.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt.toISOString()
      })),
      adminUsers: adminUserList.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      })),
      myDiaries: myDiaries.map((d) => ({
        id: d.id,
        dateStr: d.date.toISOString().split('T')[0],
        content: d.content,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      teamDiaryDays,
      permissions: permissions.map((permission) => ({
        id: permission.id,
        requesterId: permission.requesterId,
        targetId: permission.targetId,
        status: permission.status,
        updatedAt: permission.updatedAt.toISOString(),
      })),
      announcements: announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        tag: announcement.tag,
        summary: announcement.summary,
        body: announcement.body,
        pinned: announcement.pinned,
        publishedAt: announcement.publishedAt.toISOString().split('T')[0],
        readUserIds: Array.isArray(announcement.readUserIds) ? announcement.readUserIds : [],
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
