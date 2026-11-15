import { describe, expect, it } from "vitest";
import { attentionOf, describeEdit, filterStaff, oneTimePassword, permissionsFor, staffCounts, staffFilters, type StaffAccount } from "./directory";

const acc = (id: string, full_name: string, role: StaffAccount["role"], extra: Partial<StaffAccount> = {}): StaffAccount => ({
  id,
  full_name,
  role,
  is_active: true,
  updated_at: "v1",
  email: `${full_name.split(" ")[0].toLowerCase()}@ctm.test`,
  loginBlocked: false,
  ...extra,
});

const staff = [
  acc("a1", "Rowena Abella", "admin"),
  acc("a2", "Arch Coles", "admin"),
  acc("o1", "Jerome Bacalso", "operator"),
  acc("c1", "Liza Mae Dacanay", "cashier"),
  acc("c2", "Grace Villamor", "cashier", { is_active: false, loginBlocked: true }),
  acc("p1", "Arnel Quizon", "appraiser"),
];

describe("staffFilters and filterStaff", () => {
  it("reads only known values; anything else means no filter", () => {
    expect(staffFilters({ q: "  liza ", role: "cashier", status: "inactive" })).toEqual({ q: "liza", role: "cashier", status: "inactive" });
    expect(staffFilters({ role: "superadmin", status: "deleted" })).toEqual({ q: "", role: "all", status: "all" });
  });

  it("searches name or email (any order, any capitals), filters role and status, and sorts by name", () => {
    expect(filterStaff(staff, staffFilters({ q: "MAE liza" })).map((a) => a.id)).toEqual(["c1"]);
    expect(filterStaff(staff, staffFilters({ q: "jerome@" })).map((a) => a.id)).toEqual(["o1"]);
    expect(filterStaff(staff, staffFilters({ role: "cashier" })).map((a) => a.id)).toEqual(["c2", "c1"]); // Grace before Liza
    expect(filterStaff(staff, staffFilters({ status: "inactive" })).map((a) => a.id)).toEqual(["c2"]);
    expect(filterStaff(staff, staffFilters({})).map((a) => a.full_name)[0]).toBe("Arch Coles");
  });
});

describe("staffCounts", () => {
  it("counts active accounts per role", () => {
    expect(staffCounts(staff)).toEqual({ byRole: { admin: 2, operator: 1, cashier: 1, appraiser: 1 }, active: 5, total: 6 });
  });
});

describe("permissionsFor (the same rules as the server and 0084)", () => {
  it("your own account: name only, no role change, no deactivate", () => {
    const p = permissionsFor(staff[0], "a1", staff);
    expect(p).toMatchObject({ isSelf: true, canChangeRole: false, status: null });
    expect(p.roleLockedReason).toMatch(/own role/);
  });

  it("the only active Admin can't be demoted or deactivated by another Admin's screen either", () => {
    const one = [acc("a1", "Rowena Abella", "admin"), acc("a2", "Arch Coles", "admin", { is_active: false, loginBlocked: true })];
    const p = permissionsFor(one[0], "someone-else", one);
    expect(p).toMatchObject({ isLastActiveAdmin: true, canChangeRole: false, status: null });
    expect(p.statusLockedReason).toMatch(/only active Admin/);
  });

  it("other accounts: role change and Deactivate / Reactivate", () => {
    expect(permissionsFor(staff[2], "a1", staff)).toMatchObject({ canChangeRole: true, status: "deactivate" });
    expect(permissionsFor(staff[4], "a1", staff)).toMatchObject({ status: "reactivate" });
  });

  it("an unfinished step shows Finish deactivation / Finish reactivation", () => {
    const half = acc("x", "Half Done", "cashier", { is_active: false, loginBlocked: false });
    const back = acc("y", "Back Again", "cashier", { is_active: true, loginBlocked: true });
    expect(attentionOf(half)).toBe("finish-deactivation");
    expect(attentionOf(back)).toBe("finish-reactivation");
    expect(permissionsFor(half, "a1", [...staff, half]).status).toBe("finish-deactivation");
    expect(permissionsFor(back, "a1", [...staff, back]).status).toBe("finish-reactivation");
    expect(attentionOf(staff[4])).toBeNull();
  });
});

describe("describeEdit", () => {
  it("lists what changes and flags giving or removing Admin rights", () => {
    const a = { full_name: "Jerome Bacalso", role: "operator" as const };
    expect(describeEdit(a, { full_name: " Jerome  Bacalso ", role: "operator" }).changes).toEqual([]);
    const up = describeEdit(a, { full_name: "Jerome R. Bacalso", role: "admin" });
    expect(up.changes).toEqual([
      { field: "Name", from: "Jerome Bacalso", to: "Jerome R. Bacalso" },
      { field: "Role", from: "Operator", to: "Admin" },
    ]);
    expect(up.makesAdmin).toBe(true);
    expect(describeEdit({ full_name: "Rowena Abella", role: "admin" }, { full_name: "Rowena Abella", role: "cashier" }).removesAdmin).toBe(true);
    expect(describeEdit(a, { full_name: "  ", role: "operator" }).nameBlank).toBe(true);
  });
});

describe("oneTimePassword", () => {
  it("shows the password only after a real success", () => {
    expect(oneTimePassword({ success: true, tempPassword: "FAKE-pass-0000" })).toBe("FAKE-pass-0000");
    expect(oneTimePassword({ success: true, tempPassword: "FAKE-pass-0000", message: "history note" } as never)).toBe("FAKE-pass-0000");
  });
  it("never shows one for a failed or unclear result", () => {
    expect(oneTimePassword({})).toBeNull();
    expect(oneTimePassword({ error: "User not found", tempPassword: "FAKE-pass-0000" })).toBeNull();
    expect(oneTimePassword({ success: false, tempPassword: "FAKE-pass-0000" })).toBeNull();
    expect(oneTimePassword({ success: true, error: "x", tempPassword: "FAKE-pass-0000" })).toBeNull();
    expect(oneTimePassword({ success: true })).toBeNull();
    expect(oneTimePassword({ success: true, tempPassword: "" })).toBeNull();
  });
});
