import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const data = await request.formData();
  const action = data.get('action') as string;

  try {
    if (action === 'request') {
      const targetId = data.get('targetId') as string;
      if (targetId && targetId !== currentUser.id) {
        await prisma.permissionRequest.upsert({
          where: { requesterId_targetId: { requesterId: currentUser.id, targetId } },
          create: { requesterId: currentUser.id, targetId, status: 'PENDING' },
          update: { status: 'PENDING' },
        });
      }
    } else if (action === 'approve') {
      const requestId = data.get('requestId') as string;
      await prisma.permissionRequest.updateMany({
        where: { id: requestId, targetId: currentUser.id },
        data: { status: 'APPROVED' },
      });
    } else if (action === 'reject') {
      const requestId = data.get('requestId') as string;
      await prisma.permissionRequest.updateMany({
        where: { id: requestId, targetId: currentUser.id },
        data: { status: 'REJECTED' },
      });
    }
    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: '操作失败' }), { status: 500 });
  }
};
