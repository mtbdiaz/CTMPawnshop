// Phase 2B (Nov 15): the Settings → Users staff list. Pure helpers (no Supabase) so they can be unit-tested:
// search and filters, counts, which actions an account offers, and what an Edit would change.
// The server actions (app/dashboard/users/actions.ts) and the database (0084) still check everything again; these
// only decide what the page shows.

import { ROLE_LABELS, type StaffRole } from "@/lib/auth/roles";

export type StaffAccount = {
  id: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  updated_at: string;
  email: string | null;
  loginBlocked: boolean; // the Supabase sign-in block (from Phase 2A, U5)
};

export const STAFF_PAGE_SIZE = 10;
export type StatusFilter = "all" | "active" | "inactive";
export type StaffFilters = { q: string; role: StaffRole | "all"; status: StatusFilter };

const ROLES = Object.keys(ROLE_LABELS) as StaffRole[];

/** Reads ?q= ?role= ?status= safely (anything unknown = no filter). */
export function staffFilters(params: { q?: string; role?: string; status?: string }): StaffFilters {
  const role = ROLES.includes(params.role as StaffRole) ? (params.role as StaffRole) : "all";
  const status: StatusFilter = params.status === "active" || params.status === "inactive" ? params.status : "all";
  return { q: (params.q ?? "").trim().slice(0, 80), role, status };
}

/** Search by name or email (capitals and extra spaces don't matter), then role and status. Sorted by name. */
export function filterStaff(accounts: StaffAccount[], f: StaffFilters): StaffAccount[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return accounts
    .filter((a) => f.role === "all" || a.role === f.role)
    .filter((a) => f.status === "all" || (f.status === "active" ? a.is_active : !a.is_active))
    .filter((a) => {
      if (!words.length) return true;
      const text = `${a.full_name} ${a.email ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "en", { sensitivity: "base" }));
}

/** Active accounts per role, plus totals (for the summary at the top). */
export function staffCounts(accounts: StaffAccount[]) {
  const byRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<StaffRole, number>;
  for (const a of accounts) if (a.is_active) byRole[a.role]++;
  return { byRole, active: accounts.filter((a) => a.is_active).length, total: accounts.length };
}

/** U5: the account's PawnTrack status and its Supabase sign-in block disagree, so an Admin should finish the step. */
export function attentionOf(a: StaffAccount): "finish-deactivation" | "finish-reactivation" | null {
  if (!a.is_active && !a.loginBlocked) return "finish-deactivation";
  if (a.is_active && a.loginBlocked) return "finish-reactivation";
  return null;
}

export type StaffPermissions = {
  isSelf: boolean;
  /** the only active Admin: can't be demoted or deactivated (0084 refuses it too) */
  isLastActiveAdmin: boolean;
  canChangeRole: boolean;
  /** why the role can't be changed, shown in the Edit dialog */
  roleLockedReason: string | null;
  status: "deactivate" | "reactivate" | "finish-deactivation" | "finish-reactivation" | null;
  statusLockedReason: string | null;
};

/** What the signed-in Admin may do to this account (the same rules the server and database enforce). */
export function permissionsFor(a: StaffAccount, currentUserId: string, all: StaffAccount[]): StaffPermissions {
  const isSelf = a.id === currentUserId;
  const activeAdmins = all.filter((x) => x.role === "admin" && x.is_active).length;
  const isLastActiveAdmin = a.role === "admin" && a.is_active && activeAdmins <= 1;
  const attention = attentionOf(a);
  const roleLockedReason = isSelf
    ? "You can't change your own role. Ask another Admin."
    : isLastActiveAdmin
      ? "This is the only active Admin. Make another account Admin first."
      : null;
  let status: StaffPermissions["status"] = attention ?? (a.is_active ? "deactivate" : "reactivate");
  let statusLockedReason: string | null = null;
  if (isSelf) {
    status = null;
    statusLockedReason = "You can't deactivate your own account.";
  } else if (isLastActiveAdmin && status === "deactivate") {
    status = null;
    statusLockedReason = "This is the only active Admin, so it can't be deactivated.";
  }
  return { isSelf, isLastActiveAdmin, canChangeRole: roleLockedReason === null, roleLockedReason, status, statusLockedReason };
}

export type EditChange = { field: "Name" | "Role"; from: string; to: string };

/** What an Edit would change, and whether it gives or takes away Admin rights. */
export function describeEdit(a: Pick<StaffAccount, "full_name" | "role">, next: { full_name: string; role: StaffRole }) {
  const changes: EditChange[] = [];
  const name = next.full_name.trim().replace(/\s+/g, " ");
  if (name && name !== a.full_name) changes.push({ field: "Name", from: a.full_name, to: name });
  if (next.role !== a.role) changes.push({ field: "Role", from: ROLE_LABELS[a.role], to: ROLE_LABELS[next.role] });
  return {
    changes,
    nameBlank: !name,
    makesAdmin: a.role !== "admin" && next.role === "admin",
    removesAdmin: a.role === "admin" && next.role !== "admin",
  };
}

/** U6: the one-time temporary password to show, only when the action really worked. A failed action, or a result
 *  with an error, never shows a password (so it can't look like a success). */
export function oneTimePassword(s: { success?: boolean; error?: string; tempPassword?: string }): string | null {
  return s.success === true && !s.error && typeof s.tempPassword === "string" && s.tempPassword.length > 0 ? s.tempPassword : null;
}
