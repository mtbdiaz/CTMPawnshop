"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import { z } from "zod";
import { businessRulesSchema } from "@/lib/validation/settings";
import { cleanLocationName, itemsLabel, IN_SHOP_STATUSES } from "@/lib/settings/vault-locations"; // VL (Nov 15)

// message (VL, Nov 15): the success text worked out on the server (e.g. how many items are still recorded there)
export type SettingsFormState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; message?: string };

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

  // SR6 (Nov 14): save only if nobody saved Settings after this page was opened. Before: the last save always won, so a
  // second Admin with an older page open could undo a newer change without knowing. Now the row must still have the
  // "last updated" time the page was opened with; if not, nothing is saved and the Admin is told to reload.
  const expected = String(formData.get("expected_updated_at") ?? "");
  if (!expected || Number.isNaN(Date.parse(expected))) {
    return { error: "This page is out of date. Reload the page (F5) and make your changes again. Nothing was saved." };
  }

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("system_settings")
    .update({ ...parsed.data, gold_price_per_gram: parsed.data.price_24k, updated_by: user.id })
    .eq("id", 1)
    .eq("updated_at", expected)
    .select("id");

  // SR6: a plain message instead of the database's own error text (before: { error: error.message })
  if (error) return { error: "Couldn't save the changes, so nothing was changed. Check your connection and try again." };
  if (!saved || saved.length === 0) {
    return {
      error:
        "Another Admin saved Settings after you opened this page, so your changes were not saved. Reload the page (F5) to see the latest values, then make your changes again.",
    };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/appraisals");
  revalidatePath("/dashboard/loans/new"); // SR6: New Loan shows the interest, grace days and liquidated damages % from Settings
  return { success: true };
}

// ---- #37: the vault location list (migration 0038). New loans can only use a location that is switched on here.

// 2 to 40 characters, and spaces at the ends are cut off (the database has the same rule)
// VL8 (Nov 15): repeated spaces inside are made single too ("Vault  C" -> "Vault C"), so the unique rule (capitals
// don't matter) also catches a name typed with an extra space. Before: "Vault  C" and "Vault C" were two places.
const vaultNameSchema = z.object({
  name: z.string().transform(cleanLocationName).pipe(z.string().min(2, "Use at least 2 characters").max(40, "Use 40 characters or fewer")),
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
  return { success: true, message: `${parsed.data.name} added. It is now on the New Loan list.` };
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
  // VL2 (Nov 15): check the location as it is NOW, not as the page showed it. Before: a second click from an old tab
  // (or another Admin) just saved again without saying the location had already been changed.
  const { data: now } = await supabase.from("vault_locations").select("name, is_active").eq("id", id).maybeSingle();
  if (!now) return { error: "Location not found. Reload the page." };
  if (now.is_active === makeActive) {
    return { error: `${now.name} is already switched ${makeActive ? "on" : "off"}. Someone changed it after this page was opened. Reload the page to see the current list.` };
  }
  if (!makeActive) {
    // don't switch off the last one: New Loan would have nothing to choose and no loan could be made
    const { count } = await supabase.from("vault_locations").select("id", { count: "exact", head: true }).eq("is_active", true).neq("id", id);
    if (!count) return { error: "This is the only location that is switched on. Add or switch on another one first." };
  }
  // only changes the row if it is still in the state checked above (two Admins at the same moment: one wins, the other is told)
  const { data: changed, error } = await supabase.from("vault_locations").update({ is_active: makeActive }).eq("id", id).eq("is_active", !makeActive).select("id");
  if (error) return { error: "Couldn't change the location, so nothing was changed. Try again." };
  if (!changed?.length) return { error: `${now.name} was changed by someone else just now. Reload the page to see the current list.` };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/loans/new");
  if (makeActive) return { success: true, message: `${now.name} switched on. It is offered for new loans again.` };
  // VL2: counted again after saving (the number in the popup was from when the page was opened). Exact count in the
  // database (no 1,000-row limit); capitals don't matter, like the list. Nothing is moved.
  const { count: stored } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null)
    .in("status", [...IN_SHOP_STATUSES])
    .ilike("vault_location", now.name.replace(/[\\%_]/g, (c) => `\\${c}`));
  return { success: true, message: `${now.name} switched off. ${itemsLabel(stored ?? 0)} still recorded there, unchanged.` };
}
