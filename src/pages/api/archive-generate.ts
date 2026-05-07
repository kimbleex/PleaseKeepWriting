import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';
import { generateDiaryReport } from '../../lib/aiReport';
import { getPeriodRange, parseDateStr, type ReportPeriodType, toDateStr } from '../../lib/reportPeriods';

export const maxDuration = 60;

export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  let payload: { type?: ReportPeriodType; periodStart?: string; action?: 'generate' | 'cancel' };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '请求体无效' }), { status: 400 });
  }

  const type = payload?.type;
  const periodStartStr = payload?.periodStart ?? '';
  const action = payload?.action ?? 'generate';
  if (type !== 'WEEK' && type !== 'MONTH') {
    return new Response(JSON.stringify({ ok: false, error: '报告类型无效' }), { status: 400 });
  }

  const parsedStart = parseDateStr(periodStartStr);
  if (!parsedStart) {
    return new Response(JSON.stringify({ ok: false, error: '周期起始日期无效' }), { status: 400 });
  }

  if (action === 'cancel') {
    const existing = await prisma.diaryReport.findFirst({
      where: {
        userId: user.id,
        type,
        periodStart: getPeriodRange(type, parsedStart).periodStart,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.diaryReport.delete({ where: { id: existing.id } });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cancelled: !!existing,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { periodStart, periodEnd } = getPeriodRange(type, parsedStart);
  const title = type === 'WEEK'
    ? `${toDateStr(periodStart)} 至 ${toDateStr(periodEnd)} 周报`
    : `${periodStart.getUTCFullYear()}年${periodStart.getUTCMonth() + 1}月月报`;

  const report = await prisma.diaryReport.upsert({
    where: {
      userId_type_periodStart: {
        userId: user.id,
        type,
        periodStart,
      },
    },
    create: {
      userId: user.id,
      type,
      periodStart,
      periodEnd,
      title,
      status: 'PENDING',
    },
    update: {
      periodEnd,
      title,
      status: 'PENDING',
      error: null,
    },
  });

  waitUntil(
    generateDiaryReport(report.id).catch((error) => {
      console.error('archive report generation failed', error);
    }),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      report: {
        id: report.id,
        type: report.type,
        status: report.status,
        title: report.title,
        periodStart: toDateStr(report.periodStart),
        periodEnd: toDateStr(report.periodEnd),
      },
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
};
