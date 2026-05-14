export type EncryptedTextPayload = {
  v: 1;
  alg: 'AES-GCM';
  iv: string;
  ciphertext: string;
};

type StoredPrivacyKey = {
  v: 1;
  userId: string;
  key: string;
  createdAt: string;
};

export const LOCAL_PRIVACY_ERROR_CODE = 'LOCAL_PRIVACY_KEY_MISSING';
export const LOCAL_PRIVACY_STORAGE_KEY = 'our-diary-local:privacy-key:v1';

const PBKDF2_ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let cachedKey: { userId: string; rawKey: string; cryptoKey: CryptoKey } | null = null;

export class LocalPrivacyKeyMissingError extends Error {
  code = LOCAL_PRIVACY_ERROR_CODE;

  constructor(message = 'Local diary privacy key is missing') {
    super(message);
    this.name = 'LocalPrivacyKeyMissingError';
  }
}

function requireBrowserCrypto(): Crypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto is not available in this browser');
  }
  return crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function textToArrayBuffer(value: string): ArrayBuffer {
  return bytesToArrayBuffer(encoder.encode(value));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  return bytesToArrayBuffer(base64ToBytes(value));
}

function keySalt(userId: string): ArrayBuffer {
  return textToArrayBuffer(`please-keep-writing:local-first:v1:${userId}`);
}

function readStoredPrivacyKey(): StoredPrivacyKey | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(LOCAL_PRIVACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPrivacyKey;
    if (parsed?.v !== 1 || !parsed.userId || !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function importAesKey(rawKey: string): Promise<CryptoKey> {
  const browserCrypto = requireBrowserCrypto();
  return browserCrypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(rawKey),
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function getLocalPrivacyKeyUserId(): string | null {
  return readStoredPrivacyKey()?.userId ?? null;
}

export function hasLocalPrivacyKey(userId?: string): boolean {
  const stored = readStoredPrivacyKey();
  if (!stored) return false;
  return userId ? stored.userId === userId : true;
}

export async function deriveAndStoreLocalPrivacyKey(userId: string, password: string): Promise<void> {
  const browserCrypto = requireBrowserCrypto();
  const passwordKey = await browserCrypto.subtle.importKey(
    'raw',
    textToArrayBuffer(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await browserCrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: keySalt(userId),
      iterations: PBKDF2_ITERATIONS,
    },
    passwordKey,
    KEY_LENGTH_BITS,
  );
  const rawKey = bytesToBase64(new Uint8Array(bits));
  const cryptoKey = await importAesKey(rawKey);
  cachedKey = { userId, rawKey, cryptoKey };
  sessionStorage.setItem(
    LOCAL_PRIVACY_STORAGE_KEY,
    JSON.stringify({ v: 1, userId, key: rawKey, createdAt: new Date().toISOString() } satisfies StoredPrivacyKey),
  );
}

export function clearLocalPrivacyKey(): void {
  cachedKey = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(LOCAL_PRIVACY_STORAGE_KEY);
  }
}

export async function getLocalPrivacyKey(userId: string): Promise<CryptoKey> {
  const stored = readStoredPrivacyKey();
  if (!stored || stored.userId !== userId) throw new LocalPrivacyKeyMissingError();
  if (cachedKey?.userId === userId && cachedKey.rawKey === stored.key) return cachedKey.cryptoKey;
  const cryptoKey = await importAesKey(stored.key);
  cachedKey = { userId, rawKey: stored.key, cryptoKey };
  return cryptoKey;
}

export async function encryptTextForUser(userId: string, plaintext: string): Promise<EncryptedTextPayload> {
  const browserCrypto = requireBrowserCrypto();
  const key = await getLocalPrivacyKey(userId);
  const iv = browserCrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await browserCrypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: textToArrayBuffer(userId),
    },
    key,
    textToArrayBuffer(plaintext),
  );
  return {
    v: 1,
    alg: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptTextForUser(userId: string, payload: EncryptedTextPayload): Promise<string> {
  if (payload?.v !== 1 || payload.alg !== 'AES-GCM' || !payload.iv || !payload.ciphertext) {
    throw new Error('Unsupported encrypted diary payload');
  }
  const browserCrypto = requireBrowserCrypto();
  const key = await getLocalPrivacyKey(userId);
  const plaintext = await browserCrypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToArrayBuffer(payload.iv),
      additionalData: textToArrayBuffer(userId),
    },
    key,
    base64ToArrayBuffer(payload.ciphertext),
  );
  return decoder.decode(plaintext);
}

export function isLocalPrivacyKeyMissing(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && (
        (error as { code?: string }).code === LOCAL_PRIVACY_ERROR_CODE
        || (error as { name?: string }).name === 'LocalPrivacyKeyMissingError'
      ),
  );
}

export function getLocalPrivacyUnlockUrl(nextPath = `${location.pathname}${location.search}${location.hash}`): string {
  const params = new URLSearchParams({ unlock: '1', next: nextPath || '/' });
  return `/login?${params.toString()}`;
}
