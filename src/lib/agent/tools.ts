import { tool } from 'langchain';
import { z } from 'zod';
import { prisma } from '../db';
import { daysBetweenInclusive, getShanghaiDateStr, parseDateStr } from './date';

const MAX_DIARY_RANGE_DAYS = 90;
const MAX_CONTENT_CHARS_PER_DIARY = 4000;
const MAX_WRITE_CONTENT_CHARS = 20000;

function trimDiaryContent(content: string): string {
  return content.length > MAX_CONTENT_CHARS_PER_DIARY ? `${content.slice(0, MAX_CONTENT_CHARS_PER_DIARY)}...` : content;
}

function invalidDateResponse() {
  return JSON.stringify({
    ok: false,
    error: '日期格式无效，请使用 YYYY-MM-DD',
  });
}

function validateDateRange(startDate: string, endDate: string) {
  const start = parseDateStr(startDate);
  const end = parseDateStr(endDate);

  if (!start || !end) {
    return {
      ok: false as const,
      response: invalidDateResponse(),
    };
  }

  if (start.getTime() > end.getTime()) {
    return {
      ok: false as const,
      response: JSON.stringify({
        ok: false,
        error: '起始日期不能晚于结束日期',
      }),
    };
  }

  const days = daysBetweenInclusive(start, end);
  if (days > MAX_DIARY_RANGE_DAYS) {
    return {
      ok: false as const,
      response: JSON.stringify({
        ok: false,
        error: `一次最多查询 ${MAX_DIARY_RANGE_DAYS} 天的日记，请缩小日期范围`,
        range: { start_date: startDate, end_date: endDate, days },
      }),
    };
  }

  return { ok: true as const, start, end, days };
}

export function createDiaryAgentTools(userId: string) {
  const queryMyDiaries = tool(
    async ({ start_date, end_date }) => {
      const range = validateDateRange(start_date, end_date);
      if (!range.ok) return range.response;

      const diaries = await prisma.diary.findMany({
        where: {
          userId,
          date: { gte: range.start, lte: range.end },
        },
        orderBy: { date: 'asc' },
        select: { date: true, content: true, updatedAt: true },
      });

      return JSON.stringify({
        ok: true,
        range: { start_date, end_date, days: range.days },
        count: diaries.length,
        entries: diaries.map((diary) => ({
          date: diary.date.toISOString().slice(0, 10),
          updated_at: diary.updatedAt.toISOString(),
          content: trimDiaryContent(diary.content),
        })),
      });
    },
    {
      name: 'query_my_diaries_by_date_range',
      description:
        '查询当前登录用户在指定日期范围内的日记。只允许查询当前用户自己的日记。日期必须是 YYYY-MM-DD，范围包含起止日期。',
      schema: z.object({
        start_date: z.string().describe('起始日期，格式 YYYY-MM-DD'),
        end_date: z.string().describe('结束日期，格式 YYYY-MM-DD'),
      }),
    },
  );

  const upsertMyTodayDiary = tool(
    async ({ content }) => {
      const nextContent = content.trim();
      if (!nextContent) {
        return JSON.stringify({
          ok: false,
          error: '日记内容不能为空',
        });
      }

      if (nextContent.length > MAX_WRITE_CONTENT_CHARS) {
        return JSON.stringify({
          ok: false,
          error: `日记内容过长，最多 ${MAX_WRITE_CONTENT_CHARS} 字`,
        });
      }

      const todayStr = getShanghaiDateStr();
      const today = parseDateStr(todayStr);
      if (!today) return invalidDateResponse();

      const existing = await prisma.diary.findUnique({
        where: { userId_date: { userId, date: today } },
        select: { id: true, content: true, updatedAt: true },
      });

      const saved = await prisma.diary.upsert({
        where: {
          userId_date: { userId, date: today },
        },
        create: {
          userId,
          date: today,
          content: nextContent,
        },
        update: {
          content: nextContent,
        },
        select: { id: true, date: true, content: true, createdAt: true, updatedAt: true },
      });

      return JSON.stringify({
        ok: true,
        tool: 'upsert_my_today_diary',
        synced: true,
        action: existing ? 'updated' : 'created',
        date: todayStr,
        diary: {
          id: saved.id,
          date: saved.date.toISOString().slice(0, 10),
          content_length: saved.content.length,
          created_at: saved.createdAt.toISOString(),
          updated_at: saved.updatedAt.toISOString(),
        },
        previous: existing
          ? {
              id: existing.id,
              updated_at: existing.updatedAt.toISOString(),
              content_length: existing.content.length,
            }
          : null,
      });
    },
    {
      name: 'upsert_my_today_diary',
      description:
        '新建或更新当前登录用户今天的日记，并直接同步写入云端数据库。工具会先查询今天是否已有日记：没有则新建，有则用传入内容覆盖更新。只允许操作当前登录用户自己的今日日记。',
      schema: z.object({
        content: z.string().describe('要保存为今天日记正文的完整内容。会替换今天原有日记，而不是追加。'),
      }),
    },
  );

  const queryUserDiaries = tool(
    async ({ username, start_date, end_date }) => {
      const targetUsername = username.trim();
      if (!targetUsername) {
        return JSON.stringify({
          ok: false,
          error: '缺少用户名',
        });
      }

      const range = validateDateRange(start_date, end_date);
      if (!range.ok) return range.response;

      const [currentUser, targetUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, role: true },
        }),
        prisma.user.findFirst({
          where: { username: { equals: targetUsername, mode: 'insensitive' } },
          select: { id: true, username: true, role: true },
        }),
      ]);

      if (!currentUser) {
        return JSON.stringify({
          ok: false,
          error: '当前登录用户不存在',
        });
      }

      if (!targetUser) {
        return JSON.stringify({
          ok: false,
          code: 'USER_NOT_FOUND',
          username: targetUsername,
          error: `${targetUsername} 用户不存在`,
        });
      }

      if (targetUser.id !== currentUser.id && currentUser.role !== 'ADMIN') {
        const permission = await prisma.permissionRequest.findFirst({
          where: {
            requesterId: currentUser.id,
            targetId: targetUser.id,
            status: 'APPROVED',
          },
          select: { id: true },
        });

        if (!permission) {
          return JSON.stringify({
            ok: false,
            code: 'FORBIDDEN',
            username: targetUser.username,
            error: `${targetUser.username} 的日记你没有查看权限`,
          });
        }
      }

      const diaries = await prisma.diary.findMany({
        where: {
          userId: targetUser.id,
          date: { gte: range.start, lte: range.end },
        },
        orderBy: { date: 'asc' },
        select: { date: true, content: true, updatedAt: true },
      });

      return JSON.stringify({
        ok: true,
        tool: 'query_user_diaries_by_username_and_date_range',
        target_user: {
          id: targetUser.id,
          username: targetUser.username,
        },
        range: { start_date, end_date, days: range.days },
        count: diaries.length,
        entries: diaries.map((diary) => ({
          date: diary.date.toISOString().slice(0, 10),
          updated_at: diary.updatedAt.toISOString(),
          content: trimDiaryContent(diary.content),
        })),
      });
    },
    {
      name: 'query_user_diaries_by_username_and_date_range',
      description:
        '按用户名查询某个用户在指定日期范围内的日记。会先检查用户是否存在，再检查当前登录用户是否有查看权限；管理员或已获 APPROVED 权限才可查看。日期必须是 YYYY-MM-DD，范围包含起止日期。',
      schema: z.object({
        username: z.string().describe('要查询的用户名，例如 crz'),
        start_date: z.string().describe('起始日期，格式 YYYY-MM-DD'),
        end_date: z.string().describe('结束日期，格式 YYYY-MM-DD'),
      }),
    },
  );

  return [queryMyDiaries, upsertMyTodayDiary, queryUserDiaries];
}
