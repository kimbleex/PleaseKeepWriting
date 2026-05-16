import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const dateStr = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Response(JSON.stringify({ error: 'Invalid date' }), { status: 400 });
  }

  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(dateObj.getTime())) {
    return new Response(JSON.stringify({ error: 'Invalid date' }), { status: 400 });
  }

  const [allUsers, diaries, approvedRequests] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'USER' },
      orderBy: { username: 'asc' },
      select: { id: true, username: true },
    }),
    prisma.diary.findMany({
      where: { date: dateObj },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { user: { username: 'asc' } },
    }),
    prisma.permissionRequest.findMany({
      where: { requesterId: currentUser.id, status: 'APPROVED' },
      select: { targetId: true },
    }),
  ]);

  const approvedTargetIds = new Set(approvedRequests.map((r) => r.targetId));
  const diaryUserIds = new Set(diaries.map((d) => d.userId));
  const allUserIds = new Set(allUsers.map((u) => u.id));
  const [year, month, day] = dateStr.split('-').map(Number);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  const prevDate = new Date(dateObj);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const nextDate = new Date(dateObj);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const canViewDiary = (userId: string) =>
    currentUser.role === 'ADMIN' || userId === currentUser.id || approvedTargetIds.has(userId);
  const currentUserFirst = <T extends { userId?: string; id?: string; authorName: string }>(a: T, b: T) => {
    const aUserId = a.userId ?? a.id;
    const bUserId = b.userId ?? b.id;
    if (aUserId === currentUser.id) return -1;
    if (bUserId === currentUser.id) return 1;
    if (a.authorName !== b.authorName) return a.authorName < b.authorName ? -1 : 1;
    return (aUserId ?? '') < (bUserId ?? '') ? -1 : 1;
  };

  const diaryByUserId = new Map(diaries.map((diary) => [diary.userId, diary]));
  const visibleDiaries = allUsers
    .map((user) => {
      const diary = diaryByUserId.get(user.id);
      if (!diary) return null;
      const visible = canViewDiary(user.id);
      return {
        id: diary.id,
        userId: user.id,
        authorName: user.username,
        authorInitial: user.username.charAt(0).toUpperCase(),
        updatedDate: diary.updatedAt.toISOString().split('T')[0],
        visible,
        isCurrentUser: user.id === currentUser.id,
        contentAvailable: visible,
        content: visible ? diary.content : '',
      };
    })
    .filter((diary): diary is NonNullable<typeof diary> => Boolean(diary))
    .sort(currentUserFirst);

  const notWroteUsers = allUsers
    .filter((u) => !diaryUserIds.has(u.id))
    .map((u) => ({
      id: u.id,
      userId: u.id,
      authorName: u.username,
      authorInitial: u.username.charAt(0).toUpperCase(),
      isCurrentUser: u.id === currentUser.id,
    }))
    .sort(currentUserFirst);

  const legacyDiaries = diaries.map((diary) => {
    const visible = canViewDiary(diary.userId);
    return {
      id: diary.id,
      userId: diary.userId,
      authorName: diary.user.username,
      authorInitial: diary.user.username.charAt(0).toUpperCase(),
      updatedDate: diary.updatedAt.toISOString().split('T')[0],
      visible,
      isCurrentUser: diary.userId === currentUser.id,
      contentAvailable: visible,
      content: visible ? diary.content : '',
    };
  }).sort(currentUserFirst);

  return new Response(
    JSON.stringify({
      dateStr,
      year,
      month,
      day,
      weekday: weekdays[dateObj.getUTCDay()],
      prevStr: prevDate.toISOString().split('T')[0],
      nextStr: nextDate.toISOString().split('T')[0],
      wroteCount: diaries.filter((d) => allUserIds.has(d.userId)).length,
      notWroteCount: allUsers.length - diaries.filter((d) => allUserIds.has(d.userId)).length,
      totalUsers: allUsers.length,
      wroteUsers: visibleDiaries,
      notWroteUsers,
      diaries: legacyDiaries,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
