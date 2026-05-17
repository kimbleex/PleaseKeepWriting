import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser || currentUser.role !== 'ADMIN') {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const data = await request.formData();
  const userId = String(data.get('userId') ?? '').trim();

  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: '缺少用户 ID' }), { status: 400 });
  }

  if (userId === currentUser.id) {
    return new Response(JSON.stringify({ ok: false, error: '不能删除当前登录账号' }), { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  if (!targetUser) {
    return new Response(JSON.stringify({ ok: false, error: '用户不存在' }), { status: 404 });
  }

  try {
    const announcements = await prisma.announcement.findMany({
      select: { id: true, readUserIds: true },
    });
    const announcementReadUpdates = announcements
      .map((announcement) => {
        const readUserIds = Array.isArray(announcement.readUserIds)
          ? announcement.readUserIds.filter((item): item is string => typeof item === 'string' && item !== userId)
          : [];
        if (readUserIds.length === (Array.isArray(announcement.readUserIds) ? announcement.readUserIds.length : 0)) {
          return null;
        }
        return prisma.announcement.update({
          where: { id: announcement.id },
          data: { readUserIds },
        });
      })
      .filter((query): query is NonNullable<typeof query> => Boolean(query));

    await prisma.$transaction([
      prisma.permissionRequest.deleteMany({ where: { OR: [{ requesterId: userId }, { targetId: userId }] } }),
      prisma.diary.deleteMany({ where: { userId } }),
      prisma.diaryReport.deleteMany({ where: { userId } }),
      ...announcementReadUpdates,
      prisma.user.delete({ where: { id: userId } }),
    ]);

    return new Response(JSON.stringify({ ok: true, message: `已删除用户 ${targetUser.username}` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: '删除失败，请稍后再试' }), { status: 500 });
  }
};
