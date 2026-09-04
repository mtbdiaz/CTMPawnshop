"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { businessRulesSchema } from "@/lib/validation/settings";

export type SettingsFormState = { error?: string; success?: boolean };

export async function updateBusinessRules(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireRole(["admin"]);

  const parsed = businessRulesSchema.safeParse({
    interest_rate_percent: formData.get("interest_rate_percent"),
    gold_price_per_gram: formData.get("gold_price_per_gram"),
    ltv_percent: formData.get("ltv_percent"),
    grace_period_days: formData.get("grace_period_days"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("system_settings")
    .update({ ...parsed.data, updated_by: user.id })
    .eq("id", 1);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings");
  return { success: true };
}
