import { describe, it, expect, beforeEach } from "vitest";
import {
  recordFailedAttempt,
  getLockoutRemaining,
  clearAttempts,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
  type AttemptStore,
} from "./login-attempts";

function memoryStore(): AttemptStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

describe("login attempt lockout (PB-1 AC3)", () => {
  let store: AttemptStore;
  const email = "cashier@ctmpawnshop.test";

  beforeEach(() => {
    store = memoryStore();
  });

  it("does not lock before MAX_ATTEMPTS failures", () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const locked = recordFailedAttempt(store, email);
      expect(locked).toBe(false);
    }
    expect(getLockoutRemaining(store, email)).toBe(0);
  });

  it("locks on the MAX_ATTEMPTSth consecutive failure", () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) recordFailedAttempt(store, email);
    const justLocked = recordFailedAttempt(store, email);
    expect(justLocked).toBe(true);
    expect(getLockoutRemaining(store, email)).toBeGreaterThan(0);
  });

  it("lockout expires after LOCKOUT_MS", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(store, email, now);
    expect(getLockoutRemaining(store, email, now + LOCKOUT_MS - 1)).toBeGreaterThan(0);
    expect(getLockoutRemaining(store, email, now + LOCKOUT_MS + 1)).toBe(0);
  });

  it("clearAttempts resets the counter", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailedAttempt(store, email);
    clearAttempts(store, email);
    expect(getLockoutRemaining(store, email)).toBe(0);
    // a fresh failure after clearing should not immediately re-lock
    expect(recordFailedAttempt(store, email)).toBe(false);
  });

  it("tracks attempts per-email independently", () => {
    recordFailedAttempt(store, "a@example.com");
    recordFailedAttempt(store, "a@example.com");
    const lockedB = recordFailedAttempt(store, "b@example.com");
    expect(lockedB).toBe(false);
  });
});
