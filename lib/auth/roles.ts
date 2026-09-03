import type { Enums } from "@/lib/supabase/database.types";

export type StaffRole = Enums<"staff_role">;

export const ALL_ROLES: StaffRole[] = ["admin", "operator", "cashier", "appraiser"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  operator: "Operator",
  cashier: "Cashier",
  appraiser: "Appraiser",
};

/**
 * True if `role` may access a screen restricted to `allowed`. Admin can
 * always access every module (PB-3 AC2: "Given an Admin, then all modules
 * are accessible"), so it doesn't need to be listed in `allowed`.
 */
export function hasRole(role: StaffRole | null | undefined, allowed: StaffRole[]): boolean {
  if (!role) return false;
  return role === "admin" || allowed.includes(role);
}
