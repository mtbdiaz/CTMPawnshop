import { describe, expect, it } from "vitest";
import { deactivate, reactivate, STALE_MESSAGE, updateDetails, type StaffDeps, type StaffRow } from "./account-flows";

// A small fake of the database + Supabase Auth: profiles with updated_at "versions", a sign-in block flag per person,
// a history list, and switches to make a step fail.
function fake(rows: StaffRow[], opts: { blocked?: string[]; failBlock?: string; failUnblock?: string; failHistory?: string; dbError?: string } = {}) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]));
  const blocked = new Set(opts.blocked ?? rows.filter((r) => !r.is_active).map((r) => r.id));
  const history: { id: string; action: string; note?: string }[] = [];
  let tick = 100;
  const deps: StaffDeps = {
    readProfile: async (id) => (db.has(id) ? { ...db.get(id)! } : null),
    updateProfile: async (id, expected, patch) => {
      if (opts.dbError) return { error: opts.dbError };
      const row = db.get(id);
      if (!row || row.updated_at !== expected) return "stale";
      Object.assign(row, patch, { updated_at: `v${tick++}` });
      return "ok";
    },
    isLoginBlocked: async (id) => blocked.has(id),
    setLoginBlocked: async (id, b) => {
      if (b && opts.failBlock) return opts.failBlock;
      if (!b && opts.failUnblock) return opts.failUnblock;
      if (b) blocked.add(id);
      else blocked.delete(id);
      return null;
    },
    recordEvent: async (id, action, note) => {
      if (opts.failHistory) return opts.failHistory;
      history.push({ id, action, note });
      return null;
    },
  };
  return { deps, db, blocked, history };
}

const admin: StaffRow = { id: "admin", full_name: "Ana Admin", role: "admin", is_active: true, updated_at: "v1" };
const cashier: StaffRow = { id: "cash", full_name: "Carlo Cashier", role: "cashier", is_active: true, updated_at: "v1" };
const gone: StaffRow = { id: "gone", full_name: "Gina Gone", role: "operator", is_active: false, updated_at: "v1" };

describe("updateDetails (U3)", () => {
  it("changes only the name and role, never the active status", async () => {
    const f = fake([admin, gone]);
    const r = await updateDetails(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "v1", fullName: "Gina R. Gone", role: "cashier" });
    expect(r).toEqual({ success: true, message: "Saved Gina R. Gone." });
    expect(f.db.get("gone")).toMatchObject({ full_name: "Gina R. Gone", role: "cashier", is_active: false });
    expect(f.blocked.has("gone")).toBe(true); // the old bug: a Save from the page un-blocked a deactivated person
  });

  it("refuses a page that is older than the account (another Admin changed it) and changes nothing", async () => {
    const f = fake([admin, { ...cashier, updated_at: "v7" }]);
    const r = await updateDetails(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1", fullName: "X", role: "admin" });
    expect(r).toEqual({ error: STALE_MESSAGE });
    expect(f.db.get("cash")).toMatchObject({ full_name: "Carlo Cashier", role: "cashier" });
  });

  it("refuses when the other change lands between reading and saving (the database's updated_at check)", async () => {
    const f = fake([admin, cashier]);
    const read = f.deps.readProfile;
    f.deps.readProfile = async (id) => {
      const row = await read(id);
      f.db.get("cash")!.updated_at = "v9"; // another Admin saves right after our read
      return row;
    };
    const r = await updateDetails(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1", fullName: "X", role: "cashier" });
    expect(r).toEqual({ error: STALE_MESSAGE });
  });

  it("won't change your own role, says when nothing changed, and passes on database refusals", async () => {
    const f = fake([admin, cashier]);
    expect(await updateDetails(f.deps, { userId: "admin", actorId: "admin", expectedUpdatedAt: "v1", fullName: "Ana Admin", role: "cashier" })).toHaveProperty("error");
    expect(await updateDetails(f.deps, { userId: "admin", actorId: "admin", expectedUpdatedAt: "v1", fullName: "Ana B. Admin", role: "admin" })).toHaveProperty("success");
    expect(await updateDetails(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1", fullName: "Carlo Cashier", role: "cashier" })).toEqual({ error: "Nothing was changed." });
    const g = fake([admin, cashier], { dbError: "At least one active Admin must remain. Make another account Admin first." });
    expect(await updateDetails(g.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1", fullName: "C", role: "cashier" })).toEqual({ error: "At least one active Admin must remain. Make another account Admin first." });
  });
});

describe("deactivate (U3, U5)", () => {
  it("switches the profile off first, then blocks the sign-in, and records it; name and role stay as they are now", async () => {
    const f = fake([admin, { ...cashier, full_name: "Carlo NEW", updated_at: "v1" }]);
    const r = await deactivate(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1" });
    expect(r).toHaveProperty("success", true);
    expect(f.db.get("cash")).toMatchObject({ is_active: false, full_name: "Carlo NEW", role: "cashier" });
    expect(f.blocked.has("cash")).toBe(true);
    expect(f.history).toEqual([{ id: "cash", action: "login_blocked", note: undefined }]);
  });

  it("from an old page: refused, nothing changes", async () => {
    const f = fake([admin, { ...cashier, updated_at: "v5" }]);
    expect(await deactivate(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1" })).toEqual({ error: STALE_MESSAGE });
    expect(f.db.get("cash")!.is_active).toBe(true);
    expect(f.blocked.has("cash")).toBe(false);
  });

  it("if blocking the sign-in fails: stays switched off (safe), records the failure, and says how to finish", async () => {
    const f = fake([admin, cashier], { failBlock: "Auth service unavailable" });
    const r = await deactivate(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1" });
    expect(r).toMatchObject({ partial: true });
    expect("error" in r && r.error).toMatch(/can't open any page or data.*Finish deactivation/);
    expect(f.db.get("cash")!.is_active).toBe(false);
    expect(f.history).toEqual([{ id: "cash", action: "login_block_failed", note: "Auth service unavailable" }]);
  });

  it("Finish deactivation: an account that is off but not blocked gets blocked (any page age), and a full repeat is refused", async () => {
    const f = fake([admin, { ...gone }], { blocked: [] });
    const r = await deactivate(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "old" });
    expect(r).toHaveProperty("success", true);
    expect(f.blocked.has("gone")).toBe(true);
    expect(await deactivate(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "old" })).toEqual({ error: "Gina Gone is already deactivated. Reload the page." });
  });

  it("never yourself; the last Admin refusal from the database is shown and nothing is blocked", async () => {
    const f = fake([admin]);
    expect(await deactivate(f.deps, { userId: "admin", actorId: "admin", expectedUpdatedAt: "v1" })).toHaveProperty("error");
    const g = fake([admin, { ...admin, id: "a2" }], { dbError: "At least one active Admin must remain. Make another account Admin first." });
    expect(await deactivate(g.deps, { userId: "a2", actorId: "admin", expectedUpdatedAt: "v1" })).toEqual({ error: "At least one active Admin must remain. Make another account Admin first." });
    expect(g.blocked.has("a2")).toBe(false);
  });

  it("a history entry that can't be saved is reported but doesn't undo the deactivation", async () => {
    const f = fake([admin, cashier], { failHistory: "permission denied" });
    const r = await deactivate(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1" });
    expect(r).toHaveProperty("success", true);
    expect("message" in r && r.message).toMatch(/history entry could not be saved/);
    expect(f.blocked.has("cash")).toBe(true);
  });
});

describe("reactivate (U3, U5)", () => {
  it("switches the profile on, then un-blocks the sign-in, and records it", async () => {
    const f = fake([admin, gone]);
    const r = await reactivate(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "v1" });
    expect(r).toHaveProperty("success", true);
    expect(f.db.get("gone")!.is_active).toBe(true);
    expect(f.blocked.has("gone")).toBe(false);
    expect(f.history.map((h) => h.action)).toEqual(["login_unblocked"]);
  });

  it("from an old page: refused; already active: refused", async () => {
    const f = fake([admin, { ...gone, updated_at: "v3" }, cashier]);
    expect(await reactivate(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "v1" })).toEqual({ error: STALE_MESSAGE });
    expect(await reactivate(f.deps, { userId: "cash", actorId: "admin", expectedUpdatedAt: "v1" })).toEqual({ error: "Carlo Cashier is already active. Reload the page." });
  });

  it("if un-blocking fails: the person still can't sign in (safe), the failure is recorded, and Finish reactivation works later", async () => {
    const f = fake([admin, gone], { failUnblock: "timeout" });
    const r = await reactivate(f.deps, { userId: "gone", actorId: "admin", expectedUpdatedAt: "v1" });
    expect(r).toMatchObject({ partial: true });
    expect(f.blocked.has("gone")).toBe(true);
    expect(f.history.map((h) => h.action)).toEqual(["login_unblock_failed"]);
    const g = { ...f.deps, setLoginBlocked: fake([]).deps.setLoginBlocked };
    const later = await reactivate({ ...g, setLoginBlocked: async (id, b) => (b ? null : (f.blocked.delete(id), null)) }, { userId: "gone", actorId: "admin", expectedUpdatedAt: "whatever" });
    expect(later).toHaveProperty("success", true);
    expect(f.blocked.has("gone")).toBe(false);
  });
});
