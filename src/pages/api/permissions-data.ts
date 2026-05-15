import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function initial(username: string): string {
  return username.charAt(0).toUpperCase();
}

export const GET: APIRoute = async ({ cookies }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const [viewers, viewableUsers] = await Promise.all([
    prisma.permissionRequest.findMany({
      where: { targetId: currentUser.id, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      include: { requester: { select: { id: true, username: true, role: true } } },
    }),
    prisma.permissionRequest.findMany({
      where: { requesterId: currentUser.id, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      include: { target: { select: { id: true, username: true, role: true } } },
    }),
  ]);

  return json({
    viewers: viewers
      .filter((permission) => permission.requester.role === 'USER')
      .map((permission) => ({
        requestId: permission.id,
        userId: permission.requester.id,
        username: permission.requester.username,
        initial: initial(permission.requester.username),
        updatedAt: permission.updatedAt.toISOString(),
      })),
    viewableUsers: viewableUsers
      .filter((permission) => permission.target.role === 'USER')
      .map((permission) => ({
        requestId: permission.id,
        userId: permission.target.id,
        username: permission.target.username,
        initial: initial(permission.target.username),
        updatedAt: permission.updatedAt.toISOString(),
      })),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const data = await request.formData();
  const action = data.get('action');
  const requestId = data.get('requestId');

  if (action !== 'revoke' || typeof requestId !== 'string' || !requestId) {
    return json({ ok: false, error: '请求参数无效' }, 400);
  }

  const permission = await prisma.permissionRequest.findFirst({
    where: {
      id: requestId,
      targetId: currentUser.id,
      status: 'APPROVED',
    },
    include: { requester: { select: { role: true } } },
  });

  if (!permission || permission.requester.role !== 'USER') {
    return json({ ok: false, error: '授权记录不存在' }, 404);
  }

  await prisma.permissionRequest.update({
    where: { id: permission.id },
    data: { status: 'REJECTED' },
  });

  return json({ ok: true });
};
