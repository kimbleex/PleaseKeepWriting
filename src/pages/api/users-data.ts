import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const [otherUsers, sentRequests, receivedRequests] = await Promise.all([
    prisma.user.findMany({
      where: { id: { not: currentUser.id } },
      orderBy: { username: 'asc' },
      select: { id: true, username: true, role: true },
    }),
    prisma.permissionRequest.findMany({
      where: { requesterId: currentUser.id },
      select: { targetId: true, status: true },
    }),
    prisma.permissionRequest.findMany({
      where: { targetId: currentUser.id, status: 'PENDING' },
      include: { requester: { select: { id: true, username: true } } },
    }),
  ]);

  const requestsMap: Record<string, string> = {};
  sentRequests.forEach((req) => { requestsMap[req.targetId] = req.status; });

  return new Response(
    JSON.stringify({
      users: otherUsers.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: requestsMap[u.id] ?? null,
        initial: u.username.charAt(0).toUpperCase(),
      })),
      receivedRequests: receivedRequests.map((r) => ({
        id: r.id,
        requesterName: r.requester.username,
        requesterInitial: r.requester.username.charAt(0).toUpperCase(),
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
