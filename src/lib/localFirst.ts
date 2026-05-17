import {
  decryptTextForUser,
  encryptTextForUser,
  getLocalPrivacyKeyUserId,
  getLocalPrivacyUnlockUrl,
  hasLocalPrivacyKey,
  isLocalPrivacyKeyMissing,
  LocalPrivacyKeyMissingError,
  type EncryptedTextPayload,
} from './localCrypto';
import {
  buildAchievementsPageData,
  type AchievementTeamDiaryDay,
  type AchievementUser,
} from './achievements';

export { getLocalPrivacyUnlockUrl, isLocalPrivacyKeyMissing };

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

type StoredDiary = Omit<LocalDiary, 'content'> & {
  content?: string;
  encryptedContent?: EncryptedTextPayload;
  encryptionVersion?: 1;
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

export type LocalRefreshResult = {
  pushed: number;
  pulledAt: string;
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

type StoredPermission = {
  id?: string;
  requesterId: string;
  targetId: string;
  status: string;
  updatedAt?: string;
};

export type LocalAnnouncement = {
  id: string;
  title: string;
  tag: string;
  summary: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  readUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type LocalAdminUser = {
  id: string;
  username: string;
  role: string;
  createdAt: string;
};

type SyncBootstrapPayload = {
  user: { id: string; username: string; role: string; createdAt: string };
  totalUsers: number;
  users: Array<{ id: string; username: string; role: string; createdAt: string }>;
  adminUsers?: LocalAdminUser[];
  myDiaries: Array<{
    id: string;
    dateStr: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  teamDiaryDays: Array<{ dateStr: string; userId: string }>;
  permissions: Array<Required<StoredPermission>>;
  announcements?: LocalAnnouncement[];
};

const DB_NAME = 'our-diary-local';
const DB_VERSION = 5;
const STORE_DIARIES = 'diaries';
const STORE_META = 'meta';
const STORE_TEAM_DAYS = 'teamDays';
const STORE_USERS = 'users';
const STORE_PERMISSIONS = 'permissions';
const STORE_ANNOUNCEMENTS = 'announcements';
const STORE_ADMIN_USERS = 'adminUsers';
const META_PRIVACY_VERIFIER = 'privacyKeyVerifier';
const PRIVACY_VERIFIER_TEXT = 'local-first-v1';

let dbPromise: Promise<IDBDatabase> | null = null;
let refreshPromise: Promise<LocalRefreshResult> | null = null;

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
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        db.createObjectStore(STORE_USERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PERMISSIONS)) {
        db.createObjectStore(STORE_PERMISSIONS, { keyPath: ['requesterId', 'targetId'] });
      }
      if (!db.objectStoreNames.contains(STORE_ANNOUNCEMENTS)) {
        db.createObjectStore(STORE_ANNOUNCEMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ADMIN_USERS)) {
        db.createObjectStore(STORE_ADMIN_USERS, { keyPath: 'id' });
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

function requireAnyLocalPrivacyKey(): string {
  const keyUserId = getLocalPrivacyKeyUserId();
  if (!keyUserId) throw new LocalPrivacyKeyMissingError();
  return keyUserId;
}

function requireLocalPrivacyKey(userId: string): void {
  if (!hasLocalPrivacyKey(userId)) throw new LocalPrivacyKeyMissingError();
}

async function requireLocalSessionUser<T extends { id: string }>(): Promise<T> {
  const keyUserId = requireAnyLocalPrivacyKey();
  const user = await getMeta<T>('sessionUser');
  if (!user?.id) throw new Error('local session missing');
  if (user.id !== keyUserId) throw new LocalPrivacyKeyMissingError();
  requireLocalPrivacyKey(user.id);
  return user;
}

async function encryptDiaryForStorage(row: LocalDiary): Promise<StoredDiary> {
  const { content, ...stored } = row;
  return {
    ...stored,
    encryptedContent: await encryptTextForUser(row.userId, content),
    encryptionVersion: 1,
  };
}

async function decodeStoredDiary(row: StoredDiary): Promise<LocalDiary> {
  const content = row.encryptedContent
    ? await decryptTextForUser(row.userId, row.encryptedContent)
    : row.content ?? '';
  const { content: _legacyContent, encryptedContent: _encryptedContent, encryptionVersion: _encryptionVersion, ...rest } = row;
  return { ...rest, content };
}

async function getStoredDiariesByUser(userId: string): Promise<StoredDiary[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const index = tx.objectStore(STORE_DIARIES).index('by_user_date');
  const range = IDBKeyRange.bound([userId, '0000-01-01'], [userId, '9999-12-31']);
  const list = await requestResult(index.getAll(range));
  await txDone(tx);
  return (list as StoredDiary[]).sort((a, b) => (a.dateStr < b.dateStr ? 1 : -1));
}

async function migratePlaintextDiaries(userId: string): Promise<void> {
  requireLocalPrivacyKey(userId);
  const rows = await getStoredDiariesByUser(userId);
  const plaintextRows = rows.filter((row) => typeof row.content === 'string');
  if (plaintextRows.length === 0) return;

  const encryptedRows = await Promise.all(
    plaintextRows.map((row) => encryptDiaryForStorage({ ...row, content: row.content ?? '' } satisfies LocalDiary)),
  );
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readwrite');
  const store = tx.objectStore(STORE_DIARIES);
  for (const row of encryptedRows) {
    store.put(row);
  }
  await txDone(tx);
}

async function verifyStoredPrivacyKey(userId: string): Promise<boolean> {
  const verifier = await getMeta<EncryptedTextPayload>(META_PRIVACY_VERIFIER);
  if (!verifier) return true;
  try {
    return (await decryptTextForUser(userId, verifier)) === PRIVACY_VERIFIER_TEXT;
  } catch {
    return false;
  }
}

async function ensurePrivacyVerifier(userId: string): Promise<void> {
  const verifier = await getMeta<EncryptedTextPayload>(META_PRIVACY_VERIFIER);
  if (verifier) return;
  await setMeta(META_PRIVACY_VERIFIER, await encryptTextForUser(userId, PRIVACY_VERIFIER_TEXT));
}

async function markTeamDaysForRows(rows: Array<Pick<LocalDiary, 'userId' | 'dateStr'>>): Promise<void> {
  if (rows.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_TEAM_DAYS, 'readwrite');
  const store = tx.objectStore(STORE_TEAM_DAYS);
  const seen = new Set<string>();

  for (const row of rows) {
    const id = `${row.userId}:${row.dateStr}`;
    if (seen.has(id)) continue;
    seen.add(id);
    store.put({ id, userId: row.userId, dateStr: row.dateStr } satisfies TeamDiaryDay);
  }

  await txDone(tx);
}

async function getAllDiariesByUser(userId: string): Promise<LocalDiary[]> {
  requireLocalPrivacyKey(userId);
  const list = await getStoredDiariesByUser(userId);
  return Promise.all(list.map((row) => decodeStoredDiary(row)));
}

async function getDiaryByDate(userId: string, dateStr: string): Promise<LocalDiary | null> {
  requireLocalPrivacyKey(userId);
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const index = tx.objectStore(STORE_DIARIES).index('by_user_date');
  const row = await requestResult(index.get([userId, dateStr]));
  await txDone(tx);
  return row ? decodeStoredDiary(row as StoredDiary) : null;
}

export async function clearLocalForUser(userId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_DIARIES, STORE_META, STORE_TEAM_DAYS, STORE_USERS, STORE_PERMISSIONS, STORE_ANNOUNCEMENTS, STORE_ADMIN_USERS], 'readwrite');
  const diaryStore = tx.objectStore(STORE_DIARIES);
  const diaryIdx = diaryStore.index('by_user_date');
  const range = IDBKeyRange.bound([userId, '0000-01-01'], [userId, '9999-12-31']);
  const keys = await requestResult(diaryIdx.getAllKeys(range));
  for (const key of keys) diaryStore.delete(key);
  tx.objectStore(STORE_META).delete('sessionUser');
  tx.objectStore(STORE_META).delete('totalUsers');
  tx.objectStore(STORE_META).delete('lastPulledAt');
  tx.objectStore(STORE_META).delete('lastPushedAt');
  tx.objectStore(STORE_META).delete(META_PRIVACY_VERIFIER);
  tx.objectStore(STORE_TEAM_DAYS).clear();
  tx.objectStore(STORE_USERS).clear();
  tx.objectStore(STORE_PERMISSIONS).clear();
  tx.objectStore(STORE_ANNOUNCEMENTS).clear();
  tx.objectStore(STORE_ADMIN_USERS).clear();
  await txDone(tx);
}

export async function ensureBootstrap(force = false): Promise<void> {
  const keyUserId = requireAnyLocalPrivacyKey();
  if (!force) {
    const existing = await getMeta<{ id: string }>('sessionUser');
    if (existing?.id) {
      if (existing.id !== keyUserId) throw new LocalPrivacyKeyMissingError();
      if (await verifyStoredPrivacyKey(existing.id)) {
        await migratePlaintextDiaries(existing.id);
        await ensurePrivacyVerifier(existing.id);
        return;
      }
      await clearLocalForUser(existing.id);
    }
  }
  const res = await fetch('/api/sync-bootstrap');
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  const payload = (await res.json()) as SyncBootstrapPayload;
  if (payload.user.id !== keyUserId) throw new LocalPrivacyKeyMissingError();

  const currentSession = await getMeta<{ id: string }>('sessionUser');
  const existingRows = await getStoredDiariesByUser(payload.user.id);
  const existingByDate = new Map(existingRows.map((row) => [row.dateStr, row]));
  const cloudDateSet = new Set(payload.myDiaries.map((d) => d.dateStr));
  const encryptedDiaries = await Promise.all(
    payload.myDiaries.map(async (d) => {
      const old = existingByDate.get(d.dateStr);
      if (old?.needsSync) {
        return { ...old, cloudId: old.cloudId ?? d.id } as StoredDiary;
      }
      
      let parsedEncrypted: EncryptedTextPayload | null = null;
      try {
        const parsed = JSON.parse(d.content);
        if (parsed && parsed.v === 1 && parsed.alg === 'AES-GCM') {
          parsedEncrypted = parsed;
        }
      } catch {}

      if (parsedEncrypted) {
        return {
          localId: old?.localId ?? d.id,
          cloudId: d.id,
          userId: payload.user.id,
          dateStr: d.dateStr,
          updatedAt: d.updatedAt,
          createdAt: d.createdAt,
          needsSync: true, // 强制同步以洗回明文
          encryptedContent: parsedEncrypted,
          encryptionVersion: 1,
        } as StoredDiary;
      }

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
      return encryptDiaryForStorage(local);
    }),
  );
  const privacyVerifier = await encryptTextForUser(payload.user.id, PRIVACY_VERIFIER_TEXT);

  const db = await openDb();
  const tx = db.transaction([STORE_DIARIES, STORE_META, STORE_TEAM_DAYS, STORE_USERS, STORE_PERMISSIONS, STORE_ANNOUNCEMENTS, STORE_ADMIN_USERS], 'readwrite');
  const diaryStore = tx.objectStore(STORE_DIARIES);
  const teamStore = tx.objectStore(STORE_TEAM_DAYS);
  const metaStore = tx.objectStore(STORE_META);
  const userStore = tx.objectStore(STORE_USERS);
  const permStore = tx.objectStore(STORE_PERMISSIONS);
  const announcementStore = tx.objectStore(STORE_ANNOUNCEMENTS);
  const adminUserStore = tx.objectStore(STORE_ADMIN_USERS);

  if (currentSession && currentSession.id !== payload.user.id) {
    diaryStore.clear();
    teamStore.clear();
    userStore.clear();
    permStore.clear();
    announcementStore.clear();
    adminUserStore.clear();
  }

  for (const row of existingRows) {
    if (!row.needsSync && !cloudDateSet.has(row.dateStr)) {
      diaryStore.delete(row.localId);
    }
  }

  for (const row of encryptedDiaries) {
    diaryStore.put(row);
  }

  teamStore.clear();
  for (const day of payload.teamDiaryDays) {
    teamStore.put({ id: `${day.userId}:${day.dateStr}`, userId: day.userId, dateStr: day.dateStr } satisfies TeamDiaryDay);
  }

  userStore.clear();
  for (const u of payload.users) {
    userStore.put(u);
  }

  adminUserStore.clear();
  for (const u of payload.adminUsers ?? payload.users) {
    adminUserStore.put(u);
  }

  permStore.clear();
  for (const p of payload.permissions) {
    permStore.put(p);
  }

  announcementStore.clear();
  for (const announcement of payload.announcements ?? []) {
    announcementStore.put({
      ...announcement,
      readUserIds: Array.isArray(announcement.readUserIds) ? announcement.readUserIds : [],
    } satisfies LocalAnnouncement);
  }

  metaStore.put({ key: 'sessionUser', value: payload.user } satisfies MetaRecord);
  metaStore.put({ key: 'totalUsers', value: payload.totalUsers } satisfies MetaRecord);
  metaStore.put({ key: 'lastPulledAt', value: new Date().toISOString() } satisfies MetaRecord);
  metaStore.put({ key: META_PRIVACY_VERIFIER, value: privacyVerifier } satisfies MetaRecord);
  await txDone(tx);
}

export async function refreshLocalData(): Promise<LocalRefreshResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    requireAnyLocalPrivacyKey();
    const pending = await getPendingSyncCount();
    const pushResult = pending > 0 ? await syncPendingDiaries() : { synced: 0 };
    await ensureBootstrap(true);
    return { pushed: pushResult.synced, pulledAt: new Date().toISOString() };
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function sortAnnouncements(rows: LocalAnnouncement[]): LocalAnnouncement[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return b.id.localeCompare(a.id);
  });
}

export async function getAnnouncementsLocal(summaryOnly = false) {
  const sessionUser = await requireLocalSessionUser<{ id: string }>();
  const db = await openDb();
  const tx = db.transaction(STORE_ANNOUNCEMENTS, 'readonly');
  const rows = (await requestResult(tx.objectStore(STORE_ANNOUNCEMENTS).getAll())) as LocalAnnouncement[];
  await txDone(tx);
  const announcements = sortAnnouncements(rows).map((announcement) => {
    const readAt = announcement.readUserIds.includes(sessionUser.id) ? announcement.updatedAt : null;
    return {
      ...announcement,
      readAt,
      unread: !announcement.readUserIds.includes(sessionUser.id),
    };
  });
  const unreadCount = announcements.filter((announcement) => announcement.unread).length;
  return summaryOnly ? { unreadCount, announcements: [] } : { unreadCount, announcements };
}

export async function markAnnouncementReadLocal(announcementId: string): Promise<void> {
  const sessionUser = await requireLocalSessionUser<{ id: string }>();
  const db = await openDb();
  const tx = db.transaction(STORE_ANNOUNCEMENTS, 'readwrite');
  const store = tx.objectStore(STORE_ANNOUNCEMENTS);
  const row = (await requestResult(store.get(announcementId))) as LocalAnnouncement | undefined;
  if (row && !row.readUserIds.includes(sessionUser.id)) {
    store.put({ ...row, readUserIds: [...row.readUserIds, sessionUser.id] } satisfies LocalAnnouncement);
  }
  await txDone(tx);
}

export async function markAllAnnouncementsReadLocal(): Promise<void> {
  const sessionUser = await requireLocalSessionUser<{ id: string }>();
  const db = await openDb();
  const tx = db.transaction(STORE_ANNOUNCEMENTS, 'readwrite');
  const store = tx.objectStore(STORE_ANNOUNCEMENTS);
  const rows = (await requestResult(store.getAll())) as LocalAnnouncement[];
  for (const row of rows) {
    if (row.readUserIds.includes(sessionUser.id)) continue;
    store.put({ ...row, readUserIds: [...row.readUserIds, sessionUser.id] } satisfies LocalAnnouncement);
  }
  await txDone(tx);
}

function toAdminUser(row: LocalAdminUser) {
  return {
    id: row.id,
    username: row.username,
    role: row.role as 'ADMIN' | 'USER',
    initial: row.username.charAt(0).toUpperCase(),
    createdDate: row.createdAt.split('T')[0],
  };
}

export async function getAdminPageDataLocal() {
  const sessionUser = await requireLocalSessionUser<{ id: string; role: string }>();
  if (sessionUser.role !== 'ADMIN') throw new Error('Forbidden');
  const db = await openDb();
  const tx = db.transaction(STORE_ADMIN_USERS, 'readonly');
  const rows = (await requestResult(tx.objectStore(STORE_ADMIN_USERS).getAll())) as LocalAdminUser[];
  await txDone(tx);
  const users = rows
    .map(toAdminUser)
    .sort((a, b) => {
      if (a.createdDate !== b.createdDate) return a.createdDate < b.createdDate ? 1 : -1;
      return a.username.localeCompare(b.username);
    });
  return {
    currentUserId: sessionUser.id,
    users,
    totalCount: users.length,
    adminCount: users.filter((user) => user.role === 'ADMIN').length,
    userCount: users.filter((user) => user.role === 'USER').length,
  };
}

export async function getAdminAnnouncementsLocal() {
  const sessionUser = await requireLocalSessionUser<{ id: string; role: string }>();
  if (sessionUser.role !== 'ADMIN') throw new Error('Forbidden');
  const db = await openDb();
  const tx = db.transaction(STORE_ANNOUNCEMENTS, 'readonly');
  const rows = (await requestResult(tx.objectStore(STORE_ANNOUNCEMENTS).getAll())) as LocalAnnouncement[];
  await txDone(tx);
  const announcements = sortAnnouncements(rows).map((announcement) => ({
    ...announcement,
    unread: !announcement.readUserIds.includes(sessionUser.id),
    readAt: announcement.readUserIds.includes(sessionUser.id) ? announcement.updatedAt : null,
    readCount: announcement.readUserIds.length,
  }));
  return {
    unreadCount: announcements.filter((announcement) => announcement.unread).length,
    announcements,
    canManage: true,
  };
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
  const session = await requireLocalSessionUser<{ id: string }>();
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

export async function getDayPageDataLocal(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Invalid date');
  const sessionUser = await requireLocalSessionUser<{ id: string; username: string; role: string }>();
  const db = await openDb();
  const tx = db.transaction([STORE_USERS, STORE_TEAM_DAYS, STORE_PERMISSIONS], 'readonly');
  const allUsers = (await requestResult(tx.objectStore(STORE_USERS).getAll())) as Array<{
    id: string;
    username: string;
    role: string;
    createdAt: string;
  }>;
  const teamRows = (await requestResult(tx.objectStore(STORE_TEAM_DAYS).getAll())) as TeamDiaryDay[];
  const allPerms = (await requestResult(tx.objectStore(STORE_PERMISSIONS).getAll())) as StoredPermission[];
  await txDone(tx);

  const users = sessionUser.role === 'USER' && !allUsers.some((user) => user.id === sessionUser.id)
    ? [...allUsers, { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role, createdAt: '' }]
    : allUsers;
  const userRows = users
    .filter((user) => user.role === 'USER')
    .sort((a, b) => {
      if (a.id === sessionUser.id) return -1;
      if (b.id === sessionUser.id) return 1;
      if (a.username !== b.username) return a.username < b.username ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const wroteUserIds = new Set(teamRows.filter((row) => row.dateStr === dateStr).map((row) => row.userId));
  const myDiary = await getDiaryByDate(sessionUser.id, dateStr);
  if (myDiary) wroteUserIds.add(sessionUser.id);
  const approvedTargetIds = new Set(
    allPerms
      .filter((permission) => permission.requesterId === sessionUser.id && permission.status === 'APPROVED')
      .map((permission) => permission.targetId),
  );
  const canViewDiary = (userId: string) =>
    sessionUser.role === 'ADMIN' || userId === sessionUser.id || approvedTargetIds.has(userId);
  const toInitial = (username: string) => username.charAt(0).toUpperCase();

  const wroteUsers = userRows
    .filter((user) => wroteUserIds.has(user.id))
    .map((user) => {
      const isCurrentUser = user.id === sessionUser.id;
      const visible = canViewDiary(user.id);
      const contentAvailable = Boolean(isCurrentUser && myDiary);
      return {
        id: isCurrentUser && myDiary ? myDiary.localId : `${user.id}:${dateStr}`,
        userId: user.id,
        authorName: user.username,
        authorInitial: toInitial(user.username),
        updatedDate: isCurrentUser && myDiary ? myDiary.updatedAt.split('T')[0] : dateStr,
        visible,
        isCurrentUser,
        contentAvailable,
        content: contentAvailable ? myDiary?.content ?? '' : '',
      };
    });

  const notWroteUsers = userRows
    .filter((user) => !wroteUserIds.has(user.id))
    .map((user) => ({
      id: user.id,
      userId: user.id,
      authorName: user.username,
      authorInitial: toInitial(user.username),
      isCurrentUser: user.id === sessionUser.id,
    }));

  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  const [year, month, day] = dateStr.split('-').map((v) => parseInt(v, 10));
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return {
    dateStr,
    year,
    month,
    day,
    weekday: weekdays[dateObj.getUTCDay()],
    wroteCount: wroteUsers.length,
    notWroteCount: notWroteUsers.length,
    totalUsers: userRows.length,
    wroteUsers,
    notWroteUsers,
    localOnly: true,
  };
}

export async function getUsersPageDataLocal() {
  const sessionUser = await requireLocalSessionUser<{ id: string; role: string }>();
  const db = await openDb();
  const tx = db.transaction([STORE_USERS, STORE_PERMISSIONS], 'readonly');
  
  const allUsers = (await requestResult(tx.objectStore(STORE_USERS).getAll())) as Array<{ id: string; username: string; role: string; createdAt: string }>;
  const allPerms = (await requestResult(tx.objectStore(STORE_PERMISSIONS).getAll())) as StoredPermission[];
  await txDone(tx);

  const sentRequests = allPerms.filter(p => p.requesterId === sessionUser.id);
  const receivedRequests = allPerms.filter(p => p.targetId === sessionUser.id && p.status === 'PENDING');

  const requestsMap: Record<string, string> = {};
  for (const req of sentRequests) {
    requestsMap[req.targetId] = req.status;
  }

  allUsers.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.username < b.username ? -1 : 1;
  });

  const memberNumberMap = new Map(
    allUsers.map((user, index) => [user.id, String(index + 1).padStart(4, '0')])
  );

  const currentUserRecord = allUsers.find(u => u.id === sessionUser.id) ?? null;
  const otherUsers = allUsers.filter(u => u.id !== sessionUser.id);
  const visibleUsers = currentUserRecord ? [currentUserRecord, ...otherUsers] : otherUsers;

  const usersData = visibleUsers.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    status: sessionUser.role === 'ADMIN' && u.id !== sessionUser.id ? 'APPROVED' : requestsMap[u.id] ?? null,
    initial: u.username.charAt(0).toUpperCase(),
    isCurrentUser: u.id === sessionUser.id,
    memberNumber: memberNumberMap.get(u.id) ?? '0000',
  }));

  const receivedRequestsData = receivedRequests.map(r => {
    const requester = allUsers.find(u => u.id === r.requesterId);
    const username = requester?.username ?? 'Unknown';
    return {
      id: r.id ?? r.requesterId,
      requesterName: username,
      requesterInitial: username.charAt(0).toUpperCase(),
    };
  });

  return {
    users: usersData,
    receivedRequests: receivedRequestsData,
  };
}

export async function getPermissionsPageDataLocal() {
  const sessionUser = await requireLocalSessionUser<{ id: string }>();
  const db = await openDb();
  const tx = db.transaction([STORE_USERS, STORE_PERMISSIONS], 'readonly');

  const allUsers = (await requestResult(tx.objectStore(STORE_USERS).getAll())) as Array<{ id: string; username: string; role: string; createdAt: string }>;
  const allPerms = (await requestResult(tx.objectStore(STORE_PERMISSIONS).getAll())) as StoredPermission[];
  await txDone(tx);

  const userById = new Map(allUsers.map((user) => [user.id, user]));
  const toPermissionUser = (permission: StoredPermission, userId: string) => {
    const user = userById.get(userId);
    if (!user || user.role !== 'USER') return null;
    return {
      requestId: permission.id ?? '',
      userId: user.id,
      username: user.username,
      initial: user.username.charAt(0).toUpperCase(),
      updatedAt: permission.updatedAt ?? '',
    };
  };

  const viewers = allPerms
    .filter((permission) => permission.targetId === sessionUser.id && permission.status === 'APPROVED')
    .map((permission) => toPermissionUser(permission, permission.requesterId))
    .filter((user): user is NonNullable<typeof user> => user !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const viewableUsers = allPerms
    .filter((permission) => permission.requesterId === sessionUser.id && permission.status === 'APPROVED')
    .map((permission) => toPermissionUser(permission, permission.targetId))
    .filter((user): user is NonNullable<typeof user> => user !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    viewers,
    viewableUsers,
  };
}

export async function getAchievementsPageDataLocal() {
  const sessionUser = await requireLocalSessionUser<AchievementUser>();
  const db = await openDb();
  const tx = db.transaction([STORE_USERS, STORE_TEAM_DAYS], 'readonly');

  const allUsers = (await requestResult(tx.objectStore(STORE_USERS).getAll())) as AchievementUser[];
  const teamDiaryDays = (await requestResult(tx.objectStore(STORE_TEAM_DAYS).getAll())) as AchievementTeamDiaryDay[];
  await txDone(tx);

  const users = sessionUser.role === 'USER' && !allUsers.some((user) => user.id === sessionUser.id)
    ? [...allUsers, sessionUser]
    : allUsers;

  return buildAchievementsPageData({
    users,
    teamDiaryDays,
    currentUserId: sessionUser.id,
    todayDateStr: shanghaiDateStr(),
  });
}

export async function saveDiaryLocal(dateStr: string, content: string): Promise<{ localId: string; created: boolean }> {
  const user = await requireLocalSessionUser<{ id: string }>();
  const existing = await getDiaryByDate(user.id, dateStr);
  const nowIso = new Date().toISOString();
  if (existing) {
    const encrypted = await encryptDiaryForStorage({
      ...existing,
      content,
      updatedAt: nowIso,
      needsSync: true,
    } satisfies LocalDiary);
    const db = await openDb();
    const tx = db.transaction(STORE_DIARIES, 'readwrite');
    tx.objectStore(STORE_DIARIES).put(encrypted);
    await txDone(tx);
    return { localId: existing.localId, created: false };
  }
  const localId = `local-${uid()}`;
  const encrypted = await encryptDiaryForStorage({
    localId,
    cloudId: null,
    userId: user.id,
    dateStr,
    content,
    updatedAt: nowIso,
    createdAt: nowIso,
    needsSync: true,
  } satisfies LocalDiary);
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readwrite');
  tx.objectStore(STORE_DIARIES).put(encrypted);
  await txDone(tx);
  return { localId, created: true };
}

export async function getPendingSyncCount(): Promise<number> {
  const keyUserId = requireAnyLocalPrivacyKey();
  const db = await openDb();
  const tx = db.transaction(STORE_DIARIES, 'readonly');
  const list = await requestResult(tx.objectStore(STORE_DIARIES).getAll());
  await txDone(tx);
  return (list as StoredDiary[]).filter((row) => row.userId === keyUserId && row.needsSync).length;
}

export async function syncPendingDiaries(): Promise<{ synced: number }> {
  const keyUserId = requireAnyLocalPrivacyKey();
  const db = await openDb();
  const txRead = db.transaction(STORE_DIARIES, 'readonly');
  const pending = await requestResult(txRead.objectStore(STORE_DIARIES).getAll());
  await txDone(txRead);
  const pendingRows = (pending as StoredDiary[]).filter((row) => row.userId === keyUserId && row.needsSync);
  if (pendingRows.length === 0) return { synced: 0 };

  const decryptedRows = await Promise.all(
    pendingRows.map(async (row) => {
      const content = row.encryptedContent
        ? await decryptTextForUser(row.userId, row.encryptedContent)
        : row.content ?? '';
      return { ...row, content };
    })
  );

  const res = await fetch('/api/sync-push-diaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diaries: decryptedRows.map((d) => ({
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
  const updatedRows = pendingRows.map((row) => {
    const cloudId = mapping.get(row.localId) ?? row.cloudId;
    return { ...row, cloudId, needsSync: false } as StoredDiary;
  });
  const txWrite = db.transaction(STORE_DIARIES, 'readwrite');
  const store = txWrite.objectStore(STORE_DIARIES);
  for (const row of updatedRows) {
    store.put(row);
  }
  await txDone(txWrite);
  await markTeamDaysForRows(pendingRows);
  await setMeta('lastPushedAt', new Date().toISOString());
  return { synced: pendingRows.length };
}

export async function getArchiveDiaryDaysLocal(): Promise<ArchiveLocalDiary[]> {
  const user = await requireLocalSessionUser<{ id: string }>();
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
  const keyUserId = requireAnyLocalPrivacyKey();
  const db = await openDb();
  const txRead = db.transaction(STORE_DIARIES, 'readonly');
  const allRows = (await requestResult(txRead.objectStore(STORE_DIARIES).getAll())) as StoredDiary[];
  await txDone(txRead);
  const allow = new Set(localIds);
  const pendingRows = allRows.filter((row) => row.userId === keyUserId && row.needsSync && allow.has(row.localId));
  if (pendingRows.length === 0) return { synced: 0 };

  const decryptedRows = await Promise.all(
    pendingRows.map(async (row) => {
      const content = row.encryptedContent
        ? await decryptTextForUser(row.userId, row.encryptedContent)
        : row.content ?? '';
      return { ...row, content };
    })
  );

  const res = await fetch('/api/sync-push-diaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diaries: decryptedRows.map((d) => ({
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
  const updatedRows = pendingRows.map((row) => {
    const cloudId = mapping.get(row.localId) ?? row.cloudId;
    return { ...row, cloudId, needsSync: false } as StoredDiary;
  });
  const txWrite = db.transaction(STORE_DIARIES, 'readwrite');
  const store = txWrite.objectStore(STORE_DIARIES);
  for (const row of updatedRows) {
    store.put(row);
  }
  await txDone(txWrite);
  await markTeamDaysForRows(pendingRows);
  await setMeta('lastPushedAt', new Date().toISOString());
  return { synced: pendingRows.length };
}

export async function getHomeData(yearArg?: number, monthArg?: number): Promise<any> {
  const user = await requireLocalSessionUser<{ id: string; createdAt: string; role?: string }>();
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
  const tx = db.transaction([STORE_TEAM_DAYS, STORE_USERS], 'readonly');
  const teamRows = (await requestResult(tx.objectStore(STORE_TEAM_DAYS).getAll())) as TeamDiaryDay[];
  const userRows = (await requestResult(tx.objectStore(STORE_USERS).getAll())) as Array<{ id: string; username: string; role: string; createdAt: string }>;
  await txDone(tx);
  const teamMap = new Map<string, Set<string>>();
  for (const row of teamRows) {
    const set = teamMap.get(row.dateStr) ?? new Set<string>();
    set.add(row.userId);
    teamMap.set(row.dateStr, set);
  }
  if (user.role !== 'ADMIN') {
    for (const dateStr of myDateSet) {
      const set = teamMap.get(dateStr) ?? new Set<string>();
      set.add(user.id);
      teamMap.set(dateStr, set);
    }
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
  const usersById = new Map(userRows.map((row) => [row.id, row]));
  const diaryDatesByUser = new Map<string, Set<string>>();
  for (const row of teamRows) {
    if (!usersById.has(row.userId)) continue;
    const set = diaryDatesByUser.get(row.userId) ?? new Set<string>();
    set.add(row.dateStr);
    diaryDatesByUser.set(row.userId, set);
  }
  const currentStreakFor = (dateSet: Set<string>) => {
    let value = 0;
    if (dateSet.size === 0) return value;
    let cursor = toDateKey(todayDateStr);
    if (!dateSet.has(todayDateStr)) {
      const d = new Date(`${todayDateStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      cursor = toDateKey(d.toISOString().split('T')[0]);
    }
    while (true) {
      const y = Math.floor(cursor / 10000);
      const m = Math.floor((cursor % 10000) / 100);
      const d = cursor % 100;
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!dateSet.has(ds)) break;
      value += 1;
      const prev = new Date(`${ds}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      cursor = toDateKey(prev.toISOString().split('T')[0]);
    }
    return value;
  };
  const streakTop = userRows
    .filter((row) => row.role === 'USER')
    .map((row) => ({
      userId: row.id,
      username: row.username,
      isMe: row.id === user.id,
      value: currentStreakFor(diaryDatesByUser.get(row.id) ?? new Set<string>()),
    }))
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : a.username.localeCompare(b.username)));
  const monthCountByUser = new Map<string, number>();
  for (const row of teamRows) {
    if (!row.dateStr.startsWith(monthPrefix) || !usersById.has(row.userId)) continue;
    monthCountByUser.set(row.userId, (monthCountByUser.get(row.userId) ?? 0) + 1);
  }
  const monthTop = userRows
    .filter((row) => row.role === 'USER')
    .map((row) => ({
      userId: row.id,
      username: row.username,
      isMe: row.id === user.id,
      value: monthCountByUser.get(row.id) ?? 0,
    }))
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : a.username.localeCompare(b.username)));
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
    personalStats: [
      { icon: '🔥', label: '当前连续', value: streak, unit: '天' },
      { icon: '📖', label: '累计日记', value: myDiaries.length, unit: '篇' },
      { icon: '🏆', label: '最长连续', value: longestStreak, unit: '天' },
      { icon: '📅', label: '加入天数', value: daysSinceJoined, unit: '天' },
    ],
    leaderboards: {
      streakTop,
      monthTop,
    },
    monthCompletionPct,
    myMonthDiaries,
    wroteToday,
    wroteToday_me: wroteTodayMe,
    todayDateStr,
    todayWeekday: weekdayNames[new Date(`${todayDateStr}T12:00:00Z`).getUTCDay()],
    calendarCells,
  };
}
