import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db';
import { getUserFromCookie } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url }) => {
  const currentUser = getUserFromCookie(cookies);
  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(now);
  const curY = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const curM = parseInt(parts.find(p => p.type === 'month')?.value || '0');
  const curD = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const realTodayStr = `${curY}-${String(curM).padStart(2, '0')}-${String(curD).padStart(2, '0')}`;
  const shanghaiToday = new Date(`${realTodayStr}T12:00:00Z`);

  const queryYear = parseInt(url.searchParams.get('y') || '');
  const queryMonth = parseInt(url.searchParams.get('m') || '');
  const year = !isNaN(queryYear) ? queryYear : curY;
  const month =
    !isNaN(queryMonth) && queryMonth >= 1 && queryMonth <= 12
      ? queryMonth - 1
      : curM - 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const firstDayMon = (firstDayOfMonth + 6) % 7;

  const isCurrentMonth = year === curY && month === curM - 1;
  const todayDay = isCurrentMonth ? curD : -1;

  const monthStart = new Date(`${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00Z`);
  const monthEnd = new Date(
    `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}T23:59:59Z`,
  );

  const [allUserList, diariesThisMonth, totalUsers, allMyDiaries, hasWroteToday, myUser, allTeamDiaryDays] =
    await Promise.all([
      prisma.user.findMany({ where: { role: 'USER' }, orderBy: [{ createdAt: 'asc' }, { username: 'asc' }], select: { id: true, username: true } }),
      prisma.diary.findMany({
        where: { date: { gte: monthStart, lte: monthEnd } },
        select: { date: true, userId: true },
      }),
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.diary.findMany({
        where: { userId: currentUser.id },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
      prisma.diary.findFirst({
        where: {
          userId: currentUser.id,
          date: new Date(`${realTodayStr}T00:00:00Z`),
        },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { createdAt: true },
      }),
      prisma.diary.findMany({
        where: { user: { role: 'USER' } },
        select: { date: true, userId: true },
      }),
    ]);

  const allUserIds = allUserList.map((u) => u.id);

  const realTodayWroteCount = await prisma.diary.count({
    where: {
      date: new Date(`${realTodayStr}T00:00:00Z`),
      userId: { in: allUserIds },
    },
  });

  const nonAdminDiaries = diariesThisMonth.filter((d) => allUserIds.includes(d.userId));
  const diariesByDay: Record<number, number> = {};
  nonAdminDiaries.forEach((d) => {
    const day = d.date.getUTCDate();
    diariesByDay[day] = (diariesByDay[day] || 0) + 1;
  });

  const daysWithDiaries = Object.keys(diariesByDay).length;
  const wroteToday_me = !!hasWroteToday;
  const totalMyDiaries = allMyDiaries.length;

  // Streaks
  let streak = 0;
  let longestStreak = 0;
  if (allMyDiaries.length > 0) {
    const dateSets = new Set(allMyDiaries.map((d) => d.date.toISOString().split('T')[0]));
    let cur = new Date(`${realTodayStr}T00:00:00Z`);
    if (!dateSets.has(cur.toISOString().split('T')[0])) {
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    while (dateSets.has(cur.toISOString().split('T')[0])) {
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    const sorted = [...allMyDiaries].sort((a, b) => a.date.getTime() - b.date.getTime());
    let c = 1, max = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000;
      if (diff === 1) { c++; max = Math.max(max, c); } else c = 1;
    }
    longestStreak = max;
  }

  const daysSinceJoined = myUser
    ? Math.floor((now.getTime() - myUser.createdAt.getTime()) / 86400000)
    : 0;
  const myMonthDiaries = diariesThisMonth.filter((d) => d.userId === currentUser.id).length;
  const monthCompletionPct = daysInMonth > 0 ? Math.round((myMonthDiaries / daysInMonth) * 100) : 0;
  const dateKey = (date: Date) => date.toISOString().split('T')[0];
  const diaryDatesByUser = new Map<string, Set<string>>();
  allTeamDiaryDays.forEach((diary) => {
    const set = diaryDatesByUser.get(diary.userId) ?? new Set<string>();
    set.add(dateKey(diary.date));
    diaryDatesByUser.set(diary.userId, set);
  });
  const currentStreakFor = (dateSet: Set<string>) => {
    let value = 0;
    if (dateSet.size === 0) return value;
    let cursor = new Date(`${realTodayStr}T00:00:00Z`);
    if (!dateSet.has(realTodayStr)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (dateSet.has(cursor.toISOString().split('T')[0])) {
      value += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return value;
  };
  const streakTop = allUserList
    .map((user) => ({
      userId: user.id,
      username: user.username,
      isMe: user.id === currentUser.id,
      value: currentStreakFor(diaryDatesByUser.get(user.id) ?? new Set<string>()),
    }))
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : a.username.localeCompare(b.username)));
  const monthCountByUser = new Map<string, number>();
  nonAdminDiaries.forEach((diary) => {
    monthCountByUser.set(diary.userId, (monthCountByUser.get(diary.userId) ?? 0) + 1);
  });
  const monthTop = allUserList
    .map((user) => ({
      userId: user.id,
      username: user.username,
      isMe: user.id === currentUser.id,
      value: monthCountByUser.get(user.id) ?? 0,
    }))
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : a.username.localeCompare(b.username)));

  // Build calendar cells
  const calendarCells = [];
  for (let i = 0; i < firstDayMon; i++) calendarCells.push({ isEmpty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const count = diariesByDay[d] || 0;
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isMine = allMyDiaries.some((m) => m.date.toISOString().split('T')[0] === ds);
    let intensity = 0;
    if (isMine && totalUsers > 0) {
      const pct = count / totalUsers;
      intensity = pct <= 0.33 ? 1 : pct <= 0.66 ? 2 : 3;
    }
    calendarCells.push({
      isEmpty: false,
      day: d,
      dateStr: ds,
      count,
      hasDiaries: count > 0,
      isToday: d === todayDay,
      isMine,
      intensity,
      dots: Math.min(count, 5),
      title: `${ds} · ${count}/${totalUsers} 人已写`,
    });
  }

  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  return new Response(
    JSON.stringify({
      year,
      month,
      daysInMonth,
      daysWithDiaries,
      totalUsers,
      totalMyDiaries,
      streak,
      longestStreak,
      daysSinceJoined,
      personalStats: [
        { icon: '🔥', label: '当前连续', value: streak, unit: '天' },
        { icon: '📖', label: '累计日记', value: totalMyDiaries, unit: '篇' },
        { icon: '🏆', label: '最长连续', value: longestStreak, unit: '天' },
        { icon: '📅', label: '加入天数', value: daysSinceJoined, unit: '天' },
      ],
      leaderboards: {
        streakTop,
        monthTop,
      },
      monthCompletionPct,
      myMonthDiaries,
      wroteToday: realTodayWroteCount,
      wroteToday_me,
      todayDateStr: realTodayStr,
      todayWeekday: weekdayNames[shanghaiToday.getDay()],
      calendarCells,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
