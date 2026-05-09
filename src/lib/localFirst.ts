export type LocalDiary = {
  localId: string;
  cloudId: string | null;
  userId: string;
  dateStr: string;
  content: string;
  updatedAt: string;
  createdAt: string;
  needsSync: boolean;
};

export type ArchiveLocalDiary = {
  localId: string;
  cloudId: string | null;
  dateStr: string;
  content: string;
  preview: string;
  updatedAt: string;
  needsSync: boolean;
};

type MetaRecord = {
  key: string;
  value: unknown;
};

type TeamDiaryDay = {
  id: string;
  dateStr: string;
  userId: string;
};

type SyncBootstrapPayload = {
  user: { id: string; username: string; role: string; createdAt: string };
  totalUsers: number;
  myDiaries: Array<{
    id: string;
    dateStr: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  teamDiaryDays: Array<{ dateStr: string; userId: string }>;
  permissions: Array<{ requesterId: string; targetId: string; status: string }>;
};

const DB_NAME = 'our-diary-local';
const DB_VERSION = 1;
const STORE_DIARIES = 'diaries';
const STORE_META = 'meta';
const STORE_TEAM_DAYS = 'teamDays';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DIARIES)) {
        const diaries = db.createObjectStore(STORE_DIARIES, { keyPath: 'localId' });
        diaries.createIndex('by_user_date', ['userId', 'dateStr'], { unique: true });
        diaries.createIndex('by_needs_sync', 'needsSync', { unique: false });
        diaries.createIndex('by_updated_at', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_TEAM_DAYS)) {
        const team = db.createObjectStore(STORE_TEAM_DAYS, { keyPath: 'id' });
        team.createIndex('by_date', 'dateStr', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function shanghaiDateStr(input = new Date()): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(input);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function toDateKey(dateStr: string): number {
  return Number(dateStr.replaceAll('-', ''));
}

function getMonthBounds(year: number, monthIndex: number): { daysInMonth: number; firstDayMon: number } {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIndex, 1).getDay();
  return { daysInMonth, firstDayMon: (firstDayOfMonth + 6) % 7 };
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const val = await requestResult(tx.objectStore(STORE_META).get(key));
  await txDone(tx);
  return (val as MetaRecord | undefined)?.value as T ?? null;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put({ key, value } satisfies MetaRecord);
  await txDone(tx);
}

async function getAllDiariesByUser(userId: string): Promise<LocalDiary[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const index = tx.objectStore(STORE_DIARIES).index('by_user_date');
  const range = IDBKeyRange.bound([userId, '0000-01-01'], [userId, '9999-12-31']);
  const list = await requestResult(index.getAll(range));
  await txDone(tx);
  return (list as LocalDiary[]).sort((a, b) => (a.dateStr < b.dateStr ? 1 : -1));
}

async function getDiaryByDate(userId: string, dateStr: string): Promise<LocalDiary | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const index = tx.objectStore(STORE_DIARIES).index('by_user_date');
  const row = await requestResult(index.get([userId, dateStr]));
  await txDone(tx);
  return (row as LocalDiary | undefined) ?? null;
}

export async function clearLocalForUser(userId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_DIARIES, STORE_META, STORE_TEAM_DAYS], 'readwrite');
  const diaryStore = tx.objectStore(STORE_DIARIES);
  const diaryIdx = diaryStore.index('by_user_date');
  const range = IDBKeyRange.bound([userId, '0000-01-01'], [userId, '9999-12-31']);
  const keys = await requestResult(diaryIdx.getAllKeys(range));
  for (const key of keys) diaryStore.delete(key);
  tx.objectStore(STORE_META).delete('sessionUser');
  tx.objectStore(STORE_META).delete('totalUsers');
  tx.objectStore(STORE_META).delete('lastPulledAt');
  tx.objectStore(STORE_TEAM_DAYS).clear();
  await txDone(tx);
}

export async function ensureBootstrap(force = false): Promise<void> {
  if (!force) {
    const existing = await getMeta<{ id: string }>('sessionUser');
    if (existing?.id) return;
  }
  const res = await fetch('/api/sync-bootstrap');
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  const payload = (await res.json()) as SyncBootstrapPayload;
  const db = await openDb();
  const tx = db.transaction([STORE_DIARIES, STORE_META, STORE_TEAM_DAYS], 'readwrite');
  const diaryStore = tx.objectStore(STORE_DIARIES);
  const diaryIndex = diaryStore.index('by_user_date');
  const teamStore = tx.objectStore(STORE_TEAM_DAYS);
  const metaStore = tx.objectStore(STORE_META);

  const currentSession = await requestResult(metaStore.get('sessionUser'));
  const currentUserId = (currentSession as MetaRecord | undefined)?.value && (currentSession as MetaRecord).value as { id: string };
  if (currentUserId && currentUserId.id !== payload.user.id) {
    diaryStore.clear();
    teamStore.clear();
  }

  for (const d of payload.myDiaries) {
    const old = (await requestResult(diaryIndex.get([payload.user.id, d.dateStr]))) as LocalDiary | undefined;
    const local: LocalDiary = {
      localId: old?.localId ?? d.id,
      cloudId: d.id,
      userId: payload.user.id,
      dateStr: d.dateStr,
      content: d.content,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
      needsSync: old?.needsSync ?? false,
    };
    diaryStore.put(local);
  }

  teamStore.clear();
  for (const day of payload.teamDiaryDays) {
    teamStore.put({ id: `${day.userId}:${day.dateStr}`, userId: day.userId, dateStr: day.dateStr } satisfies TeamDiaryDay);
  }

  metaStore.put({ key: 'sessionUser', value: payload.user } satisfies MetaRecord);
  metaStore.put({ key: 'totalUsers', value: payload.totalUsers } satisfies MetaRecord);
  metaStore.put({ key: 'lastPulledAt', value: new Date().toISOString() } satisfies MetaRecord);
  await txDone(tx);
}

export async function getDiaryPageData(): Promise<{
  todayDateStr: string;
  todayDay: number;
  todayYear: number;
  todayMonth: number;
  todayWeekday: string;
  existingDiary: { id: string; content: string } | null;
  previousDiaries: Array<{ id: string; dateStr: string; content: string; preview: string }>;
}> {
  const user = await getMeta<{ id: string }>('sessionUser');
  if (!user?.id) await ensureBootstrap();
  const session = await getMeta<{ id: string }>('sessionUser');
  if (!session?.id) throw new Error('local session missing');
  const todayDateStr = shanghaiDateStr();
  const today = await getDiaryByDate(session.id, todayDateStr);
  const diaries = await getAllDiariesByUser(session.id);
  const previousDiaries = diaries
    .filter((d) => d.dateStr !== todayDateStr)
    .slice(0, 20)
    .map((d) => ({
      id: d.localId,
      dateStr: d.dateStr,
      content: d.content,
      preview: d.content.length > 80 ? `${d.content.slice(0, 80)}...` : d.content,
    }));
  const [year, month, day] = todayDateStr.split('-').map((v) => parseInt(v, 10));
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[new Date(`${todayDateStr}T12:00:00Z`).getUTCDay()];
  return {
    todayDateStr,
    todayDay: day,
    todayYear: year,
    todayMonth: month,
    todayWeekday: weekday,
    existingDiary: today ? { id: today.localId, content: today.content } : null,
    previousDiaries,
  };
}

export async function saveDiaryLocal(dateStr: string, content: string): Promise<{ localId: string; created: boolean }> {
  const session = await getMeta<{ id: string }>('sessionUser');
  if (!session?.id) await ensureBootstrap();
  const user = await getMeta<{ id: string }>('sessionUser');
  if (!user?.id) throw new Error('local session missing');
  const existing = await getDiaryByDate(user.id, dateStr);
  const nowIso = new Date().toISOString();
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readwrite');
  const store = tx.objectStore(STORE_DIARIES);
  if (existing) {
    store.put({
      ...existing,
      content,
      updatedAt: nowIso,
      needsSync: true,
    } satisfies LocalDiary);
    await txDone(tx);
    return { localId: existing.localId, created: false };
  }
  const localId = `local-${uid()}`;
  store.put({
    localId,
    cloudId: null,
    userId: user.id,
    dateStr,
    content,
    updatedAt: nowIso,
    createdAt: nowIso,
    needsSync: true,
  } satisfies LocalDiary);
  await txDone(tx);
  return { localId, created: true };
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const list = await requestResult(tx.objectStore(STORE_DIARIES).getAll());
  await txDone(tx);
  return (list as LocalDiary[]).filter((row) => row.needsSync).length;
}

export async function syncPendingDiaries(): Promise<{ synced: number }> {
  const db = await openDb();
  const txRead = db.transaction(STORE_DIARIES, 'readonly');
  const pending = await requestResult(txRead.objectStore(STORE_DIARIES).getAll());
  await txDone(txRead);
  const rows = (pending as LocalDiary[]).filter((row) => row.needsSync);
  if (rows.length === 0) return { synced: 0 };

  const res = await fetch('/api/sync-push-diaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diaries: rows.map((d) => ({
        localId: d.localId,
        cloudId: d.cloudId,
        dateStr: d.dateStr,
        content: d.content,
        updatedAt: d.updatedAt,
      })),
    }),
  });
  if (!res.ok) throw new Error('sync failed');
  const payload = (await res.json()) as { ok: boolean; mappings: Array<{ localId: string; cloudId: string }> };
  if (!payload.ok) throw new Error('sync failed');

  const mapping = new Map(payload.mappings.map((m) => [m.localId, m.cloudId]));
  const txWrite = db.transaction(STORE_DIARIES, 'readwrite');
  const store = txWrite.objectStore(STORE_DIARIES);
  for (const row of rows) {
    const cloudId = mapping.get(row.localId) ?? row.cloudId;
    store.put({ ...row, cloudId, needsSync: false } satisfies LocalDiary);
  }
  await txDone(txWrite);
  await setMeta('lastPushedAt', new Date().toISOString());
  return { synced: rows.length };
}

export async function getArchiveDiaryDaysLocal(): Promise<ArchiveLocalDiary[]> {
  const session = await getMeta<{ id: string }>('sessionUser');
  if (!session?.id) await ensureBootstrap();
  const user = await getMeta<{ id: string }>('sessionUser');
  if (!user?.id) throw new Error('local session missing');
  const rows = await getAllDiariesByUser(user.id);
  return rows.map((d) => {
    const text = d.content.trim().replace(/\s+/g, ' ');
    const preview = text.length > 120 ? `${text.slice(0, 120)}...` : text;
    return {
      localId: d.localId,
      cloudId: d.cloudId,
      dateStr: d.dateStr,
      content: d.content,
      preview,
      updatedAt: d.updatedAt,
      needsSync: d.needsSync,
    };
  });
}

export async function syncSelectedDiaries(localIds: string[]): Promise<{ synced: number }> {
  if (!localIds.length) return { synced: 0 };
  const db = await openDb();
  const txRead = db.transaction(STORE_DIARIES, 'readonly');
  const allRows = (await requestResult(txRead.objectStore(STORE_DIARIES).getAll())) as LocalDiary[];
  await txDone(txRead);
  const allow = new Set(localIds);
  const rows = allRows.filter((row) => row.needsSync && allow.has(row.localId));
  if (rows.length === 0) return { synced: 0 };

  const res = await fetch('/api/sync-push-diaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diaries: rows.map((d) => ({
        localId: d.localId,
        cloudId: d.cloudId,
        dateStr: d.dateStr,
        content: d.content,
        updatedAt: d.updatedAt,
      })),
    }),
  });
  if (!res.ok) throw new Error('sync failed');
  const payload = (await res.json()) as { ok: boolean; mappings: Array<{ localId: string; cloudId: string }> };
  if (!payload.ok) throw new Error('sync failed');

  const mapping = new Map(payload.mappings.map((m) => [m.localId, m.cloudId]));
  const txWrite = db.transaction(STORE_DIARIES, 'readwrite');
  const store = txWrite.objectStore(STORE_DIARIES);
  for (const row of rows) {
    const cloudId = mapping.get(row.localId) ?? row.cloudId;
    store.put({ ...row, cloudId, needsSync: false } satisfies LocalDiary);
  }
  await txDone(txWrite);
  await setMeta('lastPushedAt', new Date().toISOString());
  return { synced: rows.length };
}

export async function getHomeData(yearArg?: number, monthArg?: number): Promise<any> {
  const session = await getMeta<{ id: string; createdAt: string }>('sessionUser');
  if (!session?.id) await ensureBootstrap();
  const user = await getMeta<{ id: string; createdAt: string }>('sessionUser');
  if (!user?.id) throw new Error('local session missing');
  const totalUsers = (await getMeta<number>('totalUsers')) ?? 0;
  const todayDateStr = shanghaiDateStr();
  const [curY, curM, curD] = todayDateStr.split('-').map((v) => parseInt(v, 10));
  const year = Number.isFinite(yearArg) ? yearArg! : curY;
  const month = Number.isFinite(monthArg) ? monthArg! - 1 : curM - 1;
  const { daysInMonth, firstDayMon } = getMonthBounds(year, month);
  const isCurrentMonth = year === curY && month === curM - 1;
  const todayDay = isCurrentMonth ? curD : -1;

  const myDiaries = await getAllDiariesByUser(user.id);
  const myDateSet = new Set(myDiaries.map((d) => d.dateStr));

  const db = await openDb();
  const tx = db.transaction(STORE_TEAM_DAYS, 'readonly');
  const teamRows = (await requestResult(tx.objectStore(STORE_TEAM_DAYS).getAll())) as TeamDiaryDay[];
  await txDone(tx);
  const teamMap = new Map<string, Set<string>>();
  for (const row of teamRows) {
    const set = teamMap.get(row.dateStr) ?? new Set<string>();
    set.add(row.userId);
    teamMap.set(row.dateStr, set);
  }

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const monthDaysWithDiaries = new Set<number>();
  for (const [dateStr, set] of teamMap.entries()) {
    if (!dateStr.startsWith(monthPrefix) || set.size === 0) continue;
    const day = parseInt(dateStr.slice(-2), 10);
    monthDaysWithDiaries.add(day);
  }

  let streak = 0;
  if (myDateSet.size > 0) {
    let cursor = toDateKey(todayDateStr);
    if (!myDateSet.has(todayDateStr)) {
      const d = new Date(`${todayDateStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      cursor = toDateKey(d.toISOString().split('T')[0]);
    }
    while (true) {
      const y = Math.floor(cursor / 10000);
      const m = Math.floor((cursor % 10000) / 100);
      const d = cursor % 100;
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!myDateSet.has(ds)) break;
      streak += 1;
      const prev = new Date(`${ds}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      cursor = toDateKey(prev.toISOString().split('T')[0]);
    }
  }

  let longestStreak = 0;
  const sorted = [...myDateSet].sort();
  let run = 0;
  let prevDate = '';
  for (const ds of sorted) {
    if (!prevDate) {
      run = 1;
    } else {
      const prev = new Date(`${prevDate}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() + 1);
      run = prev.toISOString().split('T')[0] === ds ? run + 1 : 1;
    }
    if (run > longestStreak) longestStreak = run;
    prevDate = ds;
  }

  const calendarCells: any[] = [];
  for (let i = 0; i < firstDayMon; i += 1) calendarCells.push({ isEmpty: true });
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = teamMap.get(ds)?.size ?? 0;
    const isMine = myDateSet.has(ds);
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

  const myMonthDiaries = myDiaries.filter((d) => d.dateStr.startsWith(monthPrefix)).length;
  const monthCompletionPct = daysInMonth > 0 ? Math.round((myMonthDiaries / daysInMonth) * 100) : 0;
  const wroteToday = teamMap.get(todayDateStr)?.size ?? 0;
  const wroteTodayMe = myDateSet.has(todayDateStr);
  const createdAt = new Date(user.createdAt).getTime();
  const daysSinceJoined = Number.isFinite(createdAt) ? Math.floor((Date.now() - createdAt) / 86400000) : 0;
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  return {
    year,
    month,
    daysInMonth,
    daysWithDiaries: monthDaysWithDiaries.size,
    totalUsers,
    totalMyDiaries: myDiaries.length,
    streak,
    longestStreak,
    daysSinceJoined,
    monthCompletionPct,
    myMonthDiaries,
    wroteToday,
    wroteToday_me: wroteTodayMe,
    todayDateStr,
    todayWeekday: weekdayNames[new Date(`${todayDateStr}T12:00:00Z`).getUTCDay()],
    calendarCells,
  };
}
