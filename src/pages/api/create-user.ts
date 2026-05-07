import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie, hashPassword } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser || currentUser.role !== 'ADMIN') {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const data = await request.formData();
  const username = String(data.get('username') ?? '').trim();
  const password = String(data.get('password') ?? '');

  if (!username || !password) {
    return new Response(JSON.stringify({ ok: false, error: '请填写完整信息' }), { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existingUser) {
    return new Response(JSON.stringify({ ok: false, error: '用户名已存在' }), { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({ data: { username, passwordHash, role: 'USER' } });

  return new Response(JSON.stringify({ ok: true, message: `用户 ${username} 创建成功` }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
