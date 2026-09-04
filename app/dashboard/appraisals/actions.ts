"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { appraisalSchema } from "@/lib/validation/appraisal";
import { calculateValuation, isCounterfeitRisk } from "@/lib/appraisal/valuation";
import { getBlacklistStatus } from "@/lib/customers/blacklist";

export type ActionState = { error?: string; success?: boolean; appraisalId?: string };

// PB-12 + PB-13 + PB-14 + PB-15: record item details/photos, compute
// valuation from live System Settings, auto-flag counterfeit risk.
export async function createAppraisal(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["appraiser", "admin"]);

  const photoPaths = formData.getAll("photo_paths").map(String).filter(Boolean);
  const parsed = appraisalSchema.safeParse({
    customer_id: formData.get("customer_id"),
    weight_grams: formData.get("weight_grams"),
    karat: formData.get("karat"),
    purity_percent: formData.get("purity_percent"),
    condition_notes: formData.get("condition_notes"),
    photo_paths: photoPaths,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // PB-11: automatic blacklist check before a new appraisal proceeds.
  const blacklist = await getBlacklistStatus(parsed.data.customer_id);
  if (blacklist.isBlacklisted) {
    return { error: `Customer is blacklisted: ${blacklist.reason ?? "no reason on file"}. Appraisal blocked.` };
  }

  const supabase = await createClient();
  const { data: settings, error: settingsError } = await supabase
    .from("system_settings")
    .select("gold_price_per_gram, ltv_percent")
    .eq("id", 1)
    .single();
  if (settingsError || !settings) {
    return { error: "System settings unavailable — an Admin must configure the gold price first." };
  }
  if (settings.gold_price_per_gram <= 0) {
    return { error: "Gold price is not set. An Admin must configure it in System Settings before appraising." };
  }

  const valuation = calculateValuation({
    weightGrams: parsed.data.weight_grams,
    purityPercent: parsed.data.purity_percent,
    goldPricePerGram: settings.gold_price_per_gram,
    ltvPercent: settings.ltv_percent,
  });

  const counterfeitRisk = isCounterfeitRisk(parsed.data.karat, parsed.data.purity_percent);

  const { data, error } = await supabase
    .from("appraisal_items")
    .insert({
      customer_id: parsed.data.customer_id,
      weight_grams: parsed.data.weight_grams,
      karat: parsed.data.karat,
      purity_percent: parsed.data.purity_percent,
      condition_notes: parsed.data.condition_notes || null,
      photo_paths: parsed.data.photo_paths,
      gold_price_used: settings.gold_price_per_gram,
      ltv_percent_used: settings.ltv_percent,
      computed_value: valuation.value,
      suggested_loan_min: valuation.suggestedLoanMin,
      suggested_loan_max: valuation.suggestedLoanMax,
      is_counterfeit_risk: counterfeitRisk,
      counterfeit_resolution: counterfeitRisk ? "pending" : null,
      appraised_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/appraisals");
  return { success: true, appraisalId: data.id };
}

// PB-16: Admin reviews a flagged item and clears or confirms the risk.
export async function resolveCounterfeitFlag(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const appraisalId = String(formData.get("appraisal_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!appraisalId || (decision !== "cleared" && decision !== "confirmed")) {
    return { error: "Invalid resolution" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("appraisal_items")
    .update({
      counterfeit_resolution: decision,
      counterfeit_resolved_by: user.id,
      counterfeit_resolved_at: new Date().toISOString(),
    })
    .eq("id", appraisalId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/appraisals/${appraisalId}`);
  return { success: true, appraisalId };
}
