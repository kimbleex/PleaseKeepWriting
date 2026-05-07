import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }
  const data = await request.formData();
  const content = (data.get('content') as string)?.trim();
  const date = data.get('date') as string;
  const id = data.get('id') as string | null;

  if (!content) return new Response(JSON.stringify({ ok: false, error: '日记内容不能为空' }), { status: 400 });
  if (!date) return new Response(JSON.stringify({ ok: false, error: '缺少日期参数' }), { status: 400 });

  const dateObj = new Date(`${date}T00:00:00Z`);
  try {
    if (id) {
      const updated = await prisma.diary.update({ where: { id }, data: { content } });
      return new Response(JSON.stringify({ ok: true, id: updated.id, created: false }));
    } else {
      const created = await prisma.diary.create({ data: { userId: user.id, date: dateObj, content } });
      return new Response(JSON.stringify({ ok: true, id: created.id, created: true }));
    }
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: '保存失败，请重试' }), { status: 500 });
  }
};
