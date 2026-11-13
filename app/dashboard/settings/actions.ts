"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import { z } from "zod";
import { businessRulesSchema } from "@/lib/validation/settings";

export type SettingsFormState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };

export async function updateBusinessRules(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account

  const parsed = businessRulesSchema.safeParse({
    interest_rate_percent: formData.get("interest_rate_percent"),
    price_24k: formData.get("price_24k"),
    price_21k: formData.get("price_21k"),
    price_18k: formData.get("price_18k"),
    ltv_percent: formData.get("ltv_percent"),
    grace_period_days: formData.get("grace_period_days"),
    liquidated_damages_percent: formData.get("liquidated_damages_percent"), // LD (0073)
  });

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("system_settings")
    .update({ ...parsed.data, gold_price_per_gram: parsed.data.price_24k, updated_by: user.id })
    .eq("id", 1);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/appraisals");
  return { success: true };
}

// ---- #37: the vault location list (migration 0038). New loans can only use a location that is switched on here.

// 2 to 40 characters, and spaces at the ends are cut off (the database has the same rule)
const vaultNameSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(40, "Use 40 characters or fewer"),
});

// Admin adds a location, e.g. "Vault C". The same name in other capitals ("vault c") counts as the same place.
export async function addVaultLocation(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22
  const parsed = vaultNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("vault_locations").insert({ name: parsed.data.name });
  // 23505 = the unique rule on the name said no
  if (error?.code === "23505") return { fieldErrors: { name: "This location is already on the list. If it is switched off, switch it on instead." } };
  if (error) return { error: "Couldn't add the location, so nothing was changed. Try again." };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/loans/new"); // the New Loan list shows it right away
  return { success: true };
}

// Admin switches a location on or off. Off = not offered for new loans; items already stored there keep the name.
// A location is never deleted or renamed, so old records always point at a name that is still on the list.
export async function setVaultLocationActive(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22
  const id = String(formData.get("id") ?? "");
  const makeActive = formData.get("active") === "on"; // what the Admin wants it to become
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Location not found. Reload the page." };

  const supabase = await createClient();
  if (!makeActive) {
    // don't switch off the last one: New Loan would have nothing to choose and no loan could be made
    const { count } = await supabase.from("vault_locations").select("id", { count: "exact", head: true }).eq("is_active", true).neq("id", id);
    if (!count) return { error: "This is the only location that is switched on. Add or switch on another one first." };
  }
  const { error } = await supabase.from("vault_locations").update({ is_active: makeActive }).eq("id", id);
  if (error) return { error: "Couldn't change the location, so nothing was changed. Try again." };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/loans/new");
  return { success: true };
}
