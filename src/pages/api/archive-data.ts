import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';
import { getMonthStart, getPeriodRange, getWeekStart, parseDateStr, toDateStr } from '../../lib/reportPeriods';

function previewContent(content: string) {
  const text = content.trim().replace(/\s+/g, ' ');
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = new Date();
  const today = parseDateStr(toDateStr(now)) ?? now;
  const currentMonthStart = getMonthStart(today);
  const currentWeekStart = getWeekStart(today);

  const [diaries, reports] = await Promise.all([
    prisma.diary.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, content: true, createdAt: true, updatedAt: true },
    }),
    prisma.diaryReport.findMany({
      where: { userId: user.id },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const diaryMap = new Map<string, typeof diaries[number]>();
  diaries.forEach((diary) => {
    diaryMap.set(toDateStr(diary.date), diary);
  });

  const diaryDays = diaries.map((diary) => ({
    id: diary.id,
    dateStr: toDateStr(diary.date),
    content: diary.content,
    preview: previewContent(diary.content),
    updatedAt: diary.updatedAt.toISOString(),
  }));

  const reportsData = reports.map((report) => ({
    id: report.id,
    type: report.type,
    status: report.status,
    title: report.title,
    content: report.content,
    error: report.error,
    modelName: report.modelName,
    periodStart: toDateStr(report.periodStart),
    periodEnd: toDateStr(report.periodEnd),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  }));

  const weeklyGroups = new Map<string, typeof diaries>();
  const monthlyGroups = new Map<string, typeof diaries>();

  diaries.forEach((diary) => {
    const weekStart = toDateStr(getWeekStart(diary.date));
    const monthStart = toDateStr(getMonthStart(diary.date));
    if (!weeklyGroups.has(weekStart)) weeklyGroups.set(weekStart, []);
    if (!monthlyGroups.has(monthStart)) monthlyGroups.set(monthStart, []);
    weeklyGroups.get(weekStart)!.push(diary);
    monthlyGroups.get(monthStart)!.push(diary);
  });

  const buildGroups = (type: 'WEEK' | 'MONTH') => {
    const map = type === 'WEEK' ? weeklyGroups : monthlyGroups;
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([periodStart, items]) => {
        const start = parseDateStr(periodStart);
        if (!start) return null;
        const { periodEnd } = getPeriodRange(type, start);
        const report = reports.find((item) => item.type === type && toDateStr(item.periodStart) === periodStart) ?? null;
        return {
          periodStart,
          periodEnd: toDateStr(periodEnd),
          title: type === 'WEEK'
            ? `${periodStart} 周`
            : `${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月`,
          count: items.length,
          latestDateStr: toDateStr(items[0].date),
          latestPreview: previewContent(items[0].content),
          report: report
            ? {
                id: report.id,
                status: report.status,
                title: report.title,
                content: report.content,
                error: report.error,
                modelName: report.modelName,
                createdAt: report.createdAt.toISOString(),
                updatedAt: report.updatedAt.toISOString(),
              }
            : null,
        };
      })
      .filter(Boolean);
  };

  return new Response(
    JSON.stringify({
      summary: {
        totalDiaries: diaries.length,
        totalReports: reports.length,
        currentWeekCount: diaries.filter((item) => toDateStr(getWeekStart(item.date)) === toDateStr(currentWeekStart)).length,
        currentMonthCount: diaries.filter((item) => toDateStr(getMonthStart(item.date)) === toDateStr(currentMonthStart)).length,
      },
      diaryDays,
      weeklyGroups: buildGroups('WEEK'),
      monthlyGroups: buildGroups('MONTH'),
      reports: reportsData,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
