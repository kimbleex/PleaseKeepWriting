import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

type PushDiaryInput = {
  localId: string;
  cloudId: string | null;
  dateStr: string;
  content: string;
  updatedAt: string;
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  let diaries: PushDiaryInput[] = [];
  try {
    const body = await request.json();
    diaries = Array.isArray(body?.diaries) ? body.diaries : [];
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), { status: 400 });
  }

  const mappings: Array<{ localId: string; cloudId: string }> = [];

  for (const diary of diaries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(diary.dateStr) || !diary.content?.trim()) {
      continue;
    }
    const date = new Date(`${diary.dateStr}T00:00:00Z`);
    const content = diary.content.trim();
    const updated = await prisma.diary.upsert({
      where: {
        userId_date: { userId: user.id, date },
      },
      create: {
        userId: user.id,
        date,
        content,
      },
      update: {
        content,
      },
      select: { id: true },
    });
    mappings.push({ localId: diary.localId, cloudId: updated.id });
  }

  return new Response(JSON.stringify({ ok: true, mappings }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
