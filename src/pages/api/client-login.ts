import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { signToken, verifyPassword } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');

  if (!username || !password) {
    return new Response(JSON.stringify({ error: '请输入用户名和密码' }), { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (!existingUser || !(await verifyPassword(password, existingUser.passwordHash))) {
    return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401 });
  }

  const token = signToken({ id: existingUser.id, username: existingUser.username, role: existingUser.role });
  cookies.set('auth_token', token, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 7 });

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: existingUser.id,
        username: existingUser.username,
        role: existingUser.role,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
