import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { navForRole } from "@/lib/nav";
import { SessionTimeoutWatcher } from "@/components/session-timeout-watcher";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/toast";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // #8: the forced password change can't be skipped by typing /dashboard
  if (user.mustChangePassword) redirect("/force-password-change");

  return (
    <ToastProvider>
      <SessionTimeoutWatcher />
      <AppShell
        sections={navForRole(user.profile.role)}
        userName={user.profile.full_name}
        roleLabel={ROLE_LABELS[user.profile.role]}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
