import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const reportId = url.searchParams.get('id');
  if (!reportId) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });
  }

  const report = await prisma.diaryReport.findFirst({
    where: { id: reportId, userId: user.id },
  });

  if (!report) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  return new Response(
    JSON.stringify({
      id: report.id,
      type: report.type,
      status: report.status,
      title: report.title,
      content: report.content,
      error: report.error,
      modelName: report.modelName,
      periodStart: report.periodStart.toISOString().slice(0, 10),
      periodEnd: report.periodEnd.toISOString().slice(0, 10),
      updatedAt: report.updatedAt.toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
