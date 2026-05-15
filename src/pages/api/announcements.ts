import type { APIRoute } from 'astro';
import { getAnnouncementIds, getPublishedAnnouncements, findAnnouncementById } from '../../lib/announcements';
import { getUserFromCookie } from '../../lib/auth';
import { prisma } from '../../lib/db';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getAnnouncementPayload(userId: string, summaryOnly = false) {
  const announcementIds = getAnnouncementIds();
  const reads = announcementIds.length
    ? await prisma.announcementRead.findMany({
        where: {
          userId,
          announcementId: { in: announcementIds },
        },
        select: {
          announcementId: true,
          readAt: true,
        },
      })
    : [];

  const readMap = new Map(reads.map((read) => [read.announcementId, read.readAt]));
  const unreadCount = announcementIds.filter((id) => !readMap.has(id)).length;

  if (summaryOnly) {
    return { unreadCount };
  }

  return {
    unreadCount,
    announcements: getPublishedAnnouncements().map((announcement) => {
      const readAt = readMap.get(announcement.id);
      return {
        ...announcement,
        readAt: readAt ? readAt.toISOString() : null,
        unread: !readAt,
      };
    }),
  };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ error: 'Unauthorized' }, 401);
  }

  return json(await getAnnouncementPayload(currentUser.id, url.searchParams.get('summary') === '1'));
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  let payload: { action?: unknown; announcementId?: unknown };
  try {
    payload = (await request.json()) as { action?: unknown; announcementId?: unknown };
  } catch {
    return json({ ok: false, error: '请求体无效' }, 400);
  }

  const action = typeof payload.action === 'string' ? payload.action : '';

  if (action === 'mark-read') {
    const announcementId = typeof payload.announcementId === 'string' ? payload.announcementId : '';
    if (!announcementId || !findAnnouncementById(announcementId)) {
      return json({ ok: false, error: '公告不存在' }, 404);
    }

    await prisma.announcementRead.upsert({
      where: {
        userId_announcementId: {
          userId: currentUser.id,
          announcementId,
        },
      },
      create: {
        userId: currentUser.id,
        announcementId,
      },
      update: {
        readAt: new Date(),
      },
    });

    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id)) });
  }

  if (action === 'mark-all-read') {
    const now = new Date();
    await Promise.all(
      getAnnouncementIds().map((announcementId) =>
        prisma.announcementRead.upsert({
          where: {
            userId_announcementId: {
              userId: currentUser.id,
              announcementId,
            },
          },
          create: {
            userId: currentUser.id,
            announcementId,
            readAt: now,
          },
          update: {
            readAt: now,
          },
        }),
      ),
    );

    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id)) });
  }

  return json({ ok: false, error: '不支持的操作' }, 400);
};
