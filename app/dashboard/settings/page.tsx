import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("system_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">System Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        These values drive every appraisal and loan calculation across the system.
      </p>
      {settings && <SettingsForm settings={settings} />}
    </div>
  );
}
