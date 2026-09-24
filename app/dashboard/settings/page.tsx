import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Alert, Card, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "System settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: settings, error } = await supabase.from("system_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;

  return (
    <div>
      <PageHeader
        title="System settings"
        description="Business rules that drive every appraisal, loan and renewal."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "System settings" }]}
      />
      {settings ? (
        <Card>
          <SettingsForm settings={settings} />
          <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">Last updated {formatDateTime(settings.updated_at)}</p>
        </Card>
      ) : (
        <Alert tone="danger" title="Settings row missing">
          The system_settings record could not be found. Re-run the database migrations to restore it.
        </Alert>
      )}
    </div>
  );
}
