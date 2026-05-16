import type { APIRoute } from 'astro';
import { getUserFromCookie } from '../../lib/auth';
import { prisma } from '../../lib/db';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeReadUserIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function getAnnouncementRows() {
  return prisma.announcement.findMany({
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { updatedAt: 'desc' }],
  });
}

async function getAnnouncementPayload(userId: string, summaryOnly = false, canManage = false) {
  const rows = await getAnnouncementRows();
  const announcements = rows.map((announcement) => {
    const readUserIds = normalizeReadUserIds(announcement.readUserIds);
    const unread = !readUserIds.includes(userId);
    return {
      id: announcement.id,
      title: announcement.title,
      tag: announcement.tag,
      summary: announcement.summary,
      body: announcement.body,
      pinned: announcement.pinned,
      publishedAt: toDateStr(announcement.publishedAt),
      readAt: unread ? null : announcement.updatedAt.toISOString(),
      unread,
      readCount: canManage ? readUserIds.length : undefined,
      createdAt: canManage ? announcement.createdAt.toISOString() : undefined,
      updatedAt: canManage ? announcement.updatedAt.toISOString() : undefined,
    };
  });
  const unreadCount = announcements.filter((announcement) => announcement.unread).length;
  if (summaryOnly) return { unreadCount, canManage };
  return { unreadCount, announcements, canManage };
}

function normalizeAnnouncementInput(payload: Record<string, unknown>) {
  const title = String(payload.title ?? '').trim();
  const tag = String(payload.tag ?? '系统公告').trim() || '系统公告';
  const summary = String(payload.summary ?? '').trim();
  const body = String(payload.body ?? '').trim();
  const publishedAt = String(payload.publishedAt ?? '').trim();
  const pinned = Boolean(payload.pinned);

  if (!title || !summary || !body || !publishedAt) {
    return { ok: false as const, error: '请填写完整公告信息' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
    return { ok: false as const, error: '发布日期格式应为 YYYY-MM-DD' };
  }
  const date = new Date(`${publishedAt}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return { ok: false as const, error: '发布日期无效' };
  }

  return {
    ok: true as const,
    data: {
      title,
      tag,
      summary,
      body,
      publishedAt: date,
      pinned,
    },
  };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ error: 'Unauthorized' }, 401);
  }

  return json(
    await getAnnouncementPayload(
      currentUser.id,
      url.searchParams.get('summary') === '1',
      currentUser.role === 'ADMIN',
    ),
  );
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: '请求体无效' }, 400);
  }

  const action = typeof payload.action === 'string' ? payload.action : '';

  if (action === 'mark-read') {
    const announcementId = typeof payload.announcementId === 'string' ? payload.announcementId : '';
    const announcement = announcementId
      ? await prisma.announcement.findUnique({ where: { id: announcementId } })
      : null;
    if (!announcement) {
      return json({ ok: false, error: '公告不存在' }, 404);
    }

    const readUserIds = normalizeReadUserIds(announcement.readUserIds);
    if (!readUserIds.includes(currentUser.id)) readUserIds.push(currentUser.id);
    await prisma.announcement.update({
      where: { id: announcement.id },
      data: { readUserIds },
    });

    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id, false, currentUser.role === 'ADMIN')) });
  }

  if (action === 'mark-all-read') {
    const rows = await getAnnouncementRows();
    await Promise.all(
      rows.map((announcement) => {
        const readUserIds = normalizeReadUserIds(announcement.readUserIds);
        if (!readUserIds.includes(currentUser.id)) readUserIds.push(currentUser.id);
        return prisma.announcement.update({
          where: { id: announcement.id },
          data: { readUserIds },
        });
      }),
    );

    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id, false, currentUser.role === 'ADMIN')) });
  }

  if (currentUser.role !== 'ADMIN') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (action === 'create') {
    const input = normalizeAnnouncementInput(payload);
    if (!input.ok) return json({ ok: false, error: input.error }, 400);
    await prisma.announcement.create({
      data: {
        ...input.data,
        readUserIds: [],
      },
    });
    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id, false, true)) });
  }

  if (action === 'update') {
    const announcementId = typeof payload.announcementId === 'string' ? payload.announcementId : '';
    if (!announcementId) return json({ ok: false, error: '公告不存在' }, 404);
    const input = normalizeAnnouncementInput(payload);
    if (!input.ok) return json({ ok: false, error: input.error }, 400);
    await prisma.announcement.update({
      where: { id: announcementId },
      data: input.data,
    });
    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id, false, true)) });
  }

  if (action === 'reset-read') {
    const announcementId = typeof payload.announcementId === 'string' ? payload.announcementId : '';
    if (!announcementId) return json({ ok: false, error: '公告不存在' }, 404);
    await prisma.announcement.update({
      where: { id: announcementId },
      data: { readUserIds: [] },
    });
    return json({ ok: true, ...(await getAnnouncementPayload(currentUser.id, false, true)) });
  }

  return json({ ok: false, error: '不支持的操作' }, 400);
};
