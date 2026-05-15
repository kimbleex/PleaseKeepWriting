export type AchievementUser = {
  id: string;
  username: string;
  role: string;
  createdAt: string;
};

export type AchievementTeamDiaryDay = {
  userId: string;
  dateStr: string;
};

export type AchievementTone = {
  from: string;
  via: string;
  to: string;
  ink: string;
  glow: string;
  name: string;
};

export type AchievementLevelState = {
  level: number;
  threshold: number;
  earned: boolean;
  tone: AchievementTone;
};

export type AchievementRecord = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  icon: string;
  imageSrc: string;
  unit: string;
  metricLabel: string;
  level: number;
  maxLevel: number;
  points: number;
  currentValue: number;
  nextThreshold: number | null;
  progressPct: number;
  earned: boolean;
  isMaxLevel: boolean;
  achievedThreshold: number | null;
  achievedRange: { start: string; end: string; days: number } | null;
  levels: AchievementLevelState[];
  tone: AchievementTone;
};

export type AchievementMember = {
  userId: string;
  username: string;
  initial: string;
  points: number;
  earnedCount: number;
  maxSingleLevel: number;
  achievements: AchievementRecord[];
};

export type AchievementPageData = {
  currentUserId: string;
  currentUser: AchievementMember | null;
  members: AchievementMember[];
  catalog: Array<{
    id: string;
    title: string;
    description: string;
    icon: string;
    imageSrc: string;
    unit: string;
    thresholds: number[];
    levels: AchievementLevelState[];
  }>;
  summary: {
    totalMembers: number;
    totalAchievementKinds: number;
    maxPossiblePoints: number;
  };
};

type AchievementDefinition = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  icon: string;
  imageSrc: string;
  unit: string;
  metricLabel: string;
  thresholds: number[];
  kind: 'diary-streak' | 'diary-miss-streak' | 'system-age';
};

type DateRange = {
  start: string;
  end: string;
  days: number;
};

const ACHIEVEMENT_THRESHOLDS = [5, 15, 30, 45, 60, 90, 135, 180, 225, 260, 300, 365];

export const ACHIEVEMENT_LEVEL_TONES: AchievementTone[] = [
  { name: '铜橙', from: '#b45309', via: '#f59e0b', to: '#fed7aa', ink: '#7c2d12', glow: 'rgba(245, 158, 11, 0.26)' },
  { name: '蜜金', from: '#ca8a04', via: '#facc15', to: '#fef08a', ink: '#713f12', glow: 'rgba(250, 204, 21, 0.3)' },
  { name: '新芽', from: '#65a30d', via: '#a3e635', to: '#d9f99d', ink: '#365314', glow: 'rgba(132, 204, 22, 0.25)' },
  { name: '松绿', from: '#059669', via: '#34d399', to: '#a7f3d0', ink: '#064e3b', glow: 'rgba(16, 185, 129, 0.25)' },
  { name: '湖青', from: '#0891b2', via: '#22d3ee', to: '#a5f3fc', ink: '#164e63', glow: 'rgba(6, 182, 212, 0.25)' },
  { name: '天蓝', from: '#0284c7', via: '#38bdf8', to: '#bae6fd', ink: '#0c4a6e', glow: 'rgba(14, 165, 233, 0.26)' },
  { name: '星蓝', from: '#2563eb', via: '#60a5fa', to: '#bfdbfe', ink: '#1e3a8a', glow: 'rgba(37, 99, 235, 0.28)' },
  { name: '靛夜', from: '#4f46e5', via: '#818cf8', to: '#c7d2fe', ink: '#312e81', glow: 'rgba(79, 70, 229, 0.3)' },
  { name: '紫晶', from: '#7c3aed', via: '#a78bfa', to: '#ddd6fe', ink: '#4c1d95', glow: 'rgba(124, 58, 237, 0.32)' },
  { name: '玫紫', from: '#c026d3', via: '#e879f9', to: '#f5d0fe', ink: '#701a75', glow: 'rgba(217, 70, 239, 0.34)' },
  { name: '焰粉', from: '#db2777', via: '#fb7185', to: '#fecdd3', ink: '#831843', glow: 'rgba(244, 63, 94, 0.34)' },
  { name: '传说金', from: '#f97316', via: '#facc15', to: '#f0abfc', ink: '#7c2d12', glow: 'rgba(250, 204, 21, 0.42)' },
];

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'daily-streak',
    title: '不积硅步',
    shortTitle: '硅步',
    description: '一步一步把日子写成路，连续写日记达到指定天数后升级。',
    icon: 'step',
    imageSrc: '/images/achievements/daily-streak.png',
    unit: '天',
    metricLabel: '最长连续写日记',
    thresholds: ACHIEVEMENT_THRESHOLDS,
    kind: 'diary-streak',
  },
  {
    id: 'system-age',
    title: '我资格老',
    shortTitle: '资格',
    description: '来到日记系统的时间越久，徽章越有资历感。',
    icon: 'veteran',
    imageSrc: '/images/achievements/system-age.png',
    unit: '天',
    metricLabel: '来到系统',
    thresholds: ACHIEVEMENT_THRESHOLDS,
    kind: 'system-age',
  },
  {
    id: 'absence-streak',
    title: '不如不来',
    shortTitle: '不来',
    description: '连续不写日记达到指定天数后升级，主打一个来都来了但没写。',
    icon: 'absence',
    imageSrc: '/images/achievements/absence-streak.png',
    unit: '天',
    metricLabel: '最长连续未写日记',
    thresholds: ACHIEVEMENT_THRESHOLDS,
    kind: 'diary-miss-streak',
  },
];

const LOCKED_TONE: AchievementTone = {
  name: '未解锁',
  from: '#cbd5e1',
  via: '#e2e8f0',
  to: '#f8fafc',
  ink: '#64748b',
  glow: 'rgba(100, 116, 139, 0.16)',
};

function toneForLevel(level: number): AchievementTone {
  if (level <= 0) return LOCKED_TONE;
  return ACHIEVEMENT_LEVEL_TONES[Math.min(level, ACHIEVEMENT_LEVEL_TONES.length) - 1] ?? ACHIEVEMENT_LEVEL_TONES[0];
}

function initial(username: string): string {
  return username.charAt(0).toUpperCase();
}

function toUtcDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const date = toUtcDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateStr(date);
}

function dateRange(startDateStr: string, endDateStr: string): string[] {
  const totalDays = diffDaysInclusive(startDateStr, endDateStr);
  if (totalDays <= 0) return [];
  return Array.from({ length: totalDays }, (_, index) => addDays(startDateStr, index));
}

function diffDaysInclusive(startDateStr: string, endDateStr: string): number {
  const start = toUtcDate(startDateStr).getTime();
  const end = toUtcDate(endDateStr).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function datePart(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function longestConsecutiveRange(dateStrs: string[]): DateRange | null {
  const unique = [...new Set(dateStrs)].sort();
  if (unique.length === 0) return null;

  let currentStart = unique[0];
  let currentEnd = unique[0];
  let currentDays = 1;
  let best: DateRange = { start: unique[0], end: unique[0], days: 1 };

  for (let i = 1; i < unique.length; i += 1) {
    const dateStr = unique[i];
    if (addDays(currentEnd, 1) === dateStr) {
      currentEnd = dateStr;
      currentDays += 1;
    } else {
      if (currentDays > best.days || (currentDays === best.days && currentEnd > best.end)) {
        best = { start: currentStart, end: currentEnd, days: currentDays };
      }
      currentStart = dateStr;
      currentEnd = dateStr;
      currentDays = 1;
    }
  }

  if (currentDays > best.days || (currentDays === best.days && currentEnd > best.end)) {
    best = { start: currentStart, end: currentEnd, days: currentDays };
  }

  return best;
}

function levelFromValue(value: number, thresholds: number[]): number {
  return thresholds.filter((threshold) => value >= threshold).length;
}

function levelStates(level: number, thresholds: number[]): AchievementLevelState[] {
  return thresholds.map((threshold, index) => ({
    level: index + 1,
    threshold,
    earned: level >= index + 1,
    tone: toneForLevel(index + 1),
  }));
}

function recordForDefinition(
  definition: AchievementDefinition,
  user: AchievementUser,
  diaryDates: string[],
  todayDateStr: string,
): AchievementRecord {
  const maxLevel = definition.thresholds.length;
  let currentValue = 0;
  let sourceRange: DateRange | null = null;

  if (definition.kind === 'diary-streak') {
    sourceRange = longestConsecutiveRange(diaryDates);
    currentValue = sourceRange?.days ?? 0;
  } else if (definition.kind === 'diary-miss-streak') {
    const joinedDate = datePart(user.createdAt);
    const wroteDates = new Set(diaryDates);
    const missedDates = dateRange(joinedDate, todayDateStr).filter((dateStr) => !wroteDates.has(dateStr));
    sourceRange = longestConsecutiveRange(missedDates);
    currentValue = sourceRange?.days ?? 0;
  } else {
    const joinedDate = datePart(user.createdAt);
    currentValue = diffDaysInclusive(joinedDate, todayDateStr);
    sourceRange = currentValue > 0
      ? { start: joinedDate, end: todayDateStr, days: currentValue }
      : null;
  }

  const level = levelFromValue(currentValue, definition.thresholds);
  const achievedThreshold = level > 0 ? definition.thresholds[level - 1] : null;
  const achievedRange = achievedThreshold && sourceRange
    ? {
      start: sourceRange.start,
      end: addDays(sourceRange.start, achievedThreshold - 1),
      days: achievedThreshold,
    }
    : null;
  const nextThreshold = level < maxLevel ? definition.thresholds[level] : null;
  const progressPct = nextThreshold ? Math.min(100, Math.round((currentValue / nextThreshold) * 100)) : 100;

  return {
    id: definition.id,
    title: definition.title,
    shortTitle: definition.shortTitle,
    description: definition.description,
    icon: definition.icon,
    imageSrc: definition.imageSrc,
    unit: definition.unit,
    metricLabel: definition.metricLabel,
    level,
    maxLevel,
    points: level,
    currentValue,
    nextThreshold,
    progressPct,
    earned: level > 0,
    isMaxLevel: level === maxLevel,
    achievedThreshold,
    achievedRange,
    levels: levelStates(level, definition.thresholds),
    tone: toneForLevel(level),
  };
}

export function buildAchievementsPageData(input: {
  users: AchievementUser[];
  teamDiaryDays: AchievementTeamDiaryDay[];
  currentUserId: string;
  todayDateStr: string;
}): AchievementPageData {
  const diaryDatesByUser = new Map<string, string[]>();
  for (const day of input.teamDiaryDays) {
    const list = diaryDatesByUser.get(day.userId) ?? [];
    list.push(day.dateStr);
    diaryDatesByUser.set(day.userId, list);
  }

  const membersWithJoinedDate = input.users
    .filter((user) => user.role === 'USER')
    .map((user) => {
      const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => (
        recordForDefinition(definition, user, diaryDatesByUser.get(user.id) ?? [], input.todayDateStr)
      ));
      return {
        userId: user.id,
        username: user.username,
        initial: initial(user.username),
        points: achievements.reduce((sum, achievement) => sum + achievement.points, 0),
        earnedCount: achievements.filter((achievement) => achievement.earned).length,
        maxSingleLevel: Math.max(0, ...achievements.map((achievement) => achievement.level)),
        joinedDate: datePart(user.createdAt),
        createdAt: user.createdAt,
        achievements,
      };
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB && !Number.isNaN(timeA) && !Number.isNaN(timeB)) {
        return timeA - timeB;
      }
      
      if (b.maxSingleLevel !== a.maxSingleLevel) return b.maxSingleLevel - a.maxSingleLevel;
      return a.username < b.username ? -1 : 1;
    });
  const members = membersWithJoinedDate.map(({ joinedDate, createdAt, ...member }) => member);

  return {
    currentUserId: input.currentUserId,
    currentUser: members.find((member) => member.userId === input.currentUserId) ?? null,
    members,
    catalog: ACHIEVEMENT_DEFINITIONS.map((definition) => ({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      icon: definition.icon,
      imageSrc: definition.imageSrc,
      unit: definition.unit,
      thresholds: definition.thresholds,
      levels: levelStates(definition.thresholds.length, definition.thresholds),
    })),
    summary: {
      totalMembers: members.length,
      totalAchievementKinds: ACHIEVEMENT_DEFINITIONS.length,
      maxPossiblePoints: ACHIEVEMENT_DEFINITIONS.reduce((sum, definition) => sum + definition.thresholds.length, 0),
    },
  };
}
