import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { SessionTimeoutWatcher } from "@/components/session-timeout-watcher";
import { LogoutButton } from "@/components/logout-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isAdmin = user.profile.role === "admin";

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionTimeoutWatcher />
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-slate-900">CTM PawnTrack</span>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/dashboard" className="hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/dashboard/customers" className="hover:text-slate-900">
              Customers
            </Link>
            <Link href="/dashboard/appraisals" className="hover:text-slate-900">
              Appraisals
            </Link>
            <Link href="/dashboard/loans" className="hover:text-slate-900">
              Loans
            </Link>
            {isAdmin && (
              <>
                <Link href="/dashboard/settings" className="hover:text-slate-900">
                  System Settings
                </Link>
                <Link href="/dashboard/users" className="hover:text-slate-900">
                  User Accounts
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            {user.profile.full_name} · {ROLE_LABELS[user.profile.role]}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
