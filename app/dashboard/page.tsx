import { getCurrentUser } from "@/lib/auth/session";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as {user?.profile.full_name}. Module screens (Customers, Appraisals, Loans,
        etc.) are added sprint by sprint — see SPRINT_PROGRESS.md.
      </p>
    </div>
  );
}
