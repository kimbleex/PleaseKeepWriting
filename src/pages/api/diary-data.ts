import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const today = new Date();
  const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayDateObj = new Date(`${todayDateStr}T00:00:00Z`);

  const [existingDiary, previousDiaries] = await Promise.all([
    prisma.diary.findFirst({ where: { userId: user.id, date: todayDateObj } }),
    prisma.diary.findMany({
      where: { userId: user.id, date: { not: todayDateObj } },
      orderBy: { date: 'desc' },
      take: 20,
    }),
  ]);

  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  return new Response(
    JSON.stringify({
      todayDateStr,
      todayDay: today.getDate(),
      todayYear: today.getFullYear(),
      todayMonth: today.getMonth() + 1,
      todayWeekday: weekdays[today.getDay()],
      existingDiary: existingDiary
        ? { id: existingDiary.id, content: existingDiary.content }
        : null,
      previousDiaries: previousDiaries.map((d) => ({
        id: d.id,
        dateStr: d.date.toISOString().split('T')[0],
        content: d.content,
        preview: d.content.length > 80 ? d.content.slice(0, 80) + '…' : d.content,
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
