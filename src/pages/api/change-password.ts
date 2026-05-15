import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie, hashPassword, verifyPassword } from '../../lib/auth';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? '');
  const newPassword = String(body?.newPassword ?? '');

  if (!currentPassword || !newPassword) {
    return json({ ok: false, error: '请填写完整信息' }, 400);
  }

  if (newPassword.length < 8 || newPassword.length > 128) {
    return json({ ok: false, error: '新密码长度需要在 8 到 128 位之间' }, 400);
  }

  if (newPassword === currentPassword) {
    return json({ ok: false, error: '新密码不能和原密码相同' }, 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, passwordHash: true },
  });

  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return json({ ok: false, error: '原密码不正确' }, 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  cookies.delete('auth_token', { path: '/' });
  return json({ ok: true, redirect: '/login?passwordChanged=1' });
};
