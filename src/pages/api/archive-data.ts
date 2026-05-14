import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

function previewContent(content: string) {
  const text = content.trim().replace(/\s+/g, ' ');
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const diaries = await prisma.diary.findMany({
    where: { userId: user.id },
    orderBy: { date: 'desc' },
    select: { id: true, date: true, content: true, updatedAt: true },
  });

  const diaryDays = diaries.map((diary) => ({
    id: diary.id,
    dateStr: toDateStr(diary.date),
    content: diary.content,
    preview: previewContent(diary.content),
    updatedAt: diary.updatedAt.toISOString(),
  }));

  return new Response(
    JSON.stringify({
      summary: {
        totalDiaries: diaries.length,
      },
      diaryDays,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
