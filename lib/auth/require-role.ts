import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { hasRole, type StaffRole } from "@/lib/auth/roles";

/**
 * Server-page guard for PB-3 (RBAC): loads the current user and redirects to
 * /dashboard if their role isn't in `allowed` (admin always passes).
 */
export async function requireRole(allowed: StaffRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // D2: "?denied=1" tells the Dashboard to explain why the user landed there
  if (!hasRole(user.profile.role, allowed)) redirect("/dashboard?denied=1");
  return user;
}
