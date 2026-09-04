// PB-1 AC3: after 3 consecutive failed attempts, warn/lock the account (client-side).
// A minimal, dependency-injected tracker so the decision logic is unit-testable
// without a real browser localStorage.

export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS = 60_000;

export interface AttemptStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

type AttemptRecord = { count: number; lockedUntil: number | null };

function keyFor(email: string) {
  return `login_attempts:${email.trim().toLowerCase()}`;
}

function read(store: AttemptStore, email: string): AttemptRecord {
  const raw = store.get(keyFor(email));
  if (!raw) return { count: 0, lockedUntil: null };
  try {
    return JSON.parse(raw) as AttemptRecord;
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function write(store: AttemptStore, email: string, record: AttemptRecord) {
  store.set(keyFor(email), JSON.stringify(record));
}

/** Returns remaining lockout ms if locked, or 0 if the user may attempt login now. */
export function getLockoutRemaining(store: AttemptStore, email: string, now = Date.now()): number {
  const record = read(store, email);
  if (!record.lockedUntil) return 0;
  const remaining = record.lockedUntil - now;
  return remaining > 0 ? remaining : 0;
}

/** Call after a failed login. Returns true if this failure just triggered a lockout. */
export function recordFailedAttempt(store: AttemptStore, email: string, now = Date.now()): boolean {
  const record = read(store, email);
  const count = record.count + 1;
  if (count >= MAX_ATTEMPTS) {
    write(store, email, { count: 0, lockedUntil: now + LOCKOUT_MS });
    return true;
  }
  write(store, email, { count, lockedUntil: null });
  return false;
}

/** Call after a successful login to clear any tracked failures. */
export function clearAttempts(store: AttemptStore, email: string) {
  store.remove(keyFor(email));
}

export const localStorageAttemptStore: AttemptStore = {
  get: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  set: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  remove: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};
