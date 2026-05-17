import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const [regularUsers, sentRequests, receivedRequests] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'USER' },
      orderBy: [{ createdAt: 'asc' }, { username: 'asc' }],
      select: { id: true, username: true, role: true, createdAt: true },
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
  const memberNumberMap = new Map(
    regularUsers.map((user, index) => [user.id, String(index + 1).padStart(4, '0')]),
  );
  const currentUserRecord = regularUsers.find((user) => user.id === currentUser.id) ?? null;
  const otherUsers = regularUsers.filter((user) => user.id !== currentUser.id);
  const visibleUsers = currentUserRecord ? [currentUserRecord, ...otherUsers] : otherUsers;

  return new Response(
    JSON.stringify({
      users: visibleUsers.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: currentUser.role === 'ADMIN' && u.id !== currentUser.id ? 'APPROVED' : requestsMap[u.id] ?? null,
        initial: u.username.charAt(0).toUpperCase(),
        isCurrentUser: u.id === currentUser.id,
        memberNumber: memberNumberMap.get(u.id) ?? '0000',
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
