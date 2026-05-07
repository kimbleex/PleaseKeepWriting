import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  const todayDateStr = `${y}-${m}-${d}`;
  const todayDateObj = new Date(`${todayDateStr}T00:00:00Z`);

  // For display info (weekday etc) based on the Shanghai date
  const shanghaiToday = new Date(`${todayDateStr}T12:00:00Z`); // Mid-day to avoid edge cases

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
      todayDay: parseInt(d || '0'),
      todayYear: parseInt(y || '0'),
      todayMonth: parseInt(m || '0'),
      todayWeekday: weekdays[shanghaiToday.getDay()],
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
