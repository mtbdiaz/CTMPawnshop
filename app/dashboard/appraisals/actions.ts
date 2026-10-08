"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { appraisalSchema } from "@/lib/validation/appraisal";
import { validationFailure, type FieldErrors } from "@/lib/validation/errors";
import { calculateKaratValuation } from "@/lib/appraisal/valuation";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; appraisalId?: string };

function parse(formData: FormData) {
  return appraisalSchema.safeParse({
    category: formData.get("category"),
    category_other: formData.get("category_other") ?? undefined,
    karat: formData.get("karat"),
    weight_grams: formData.get("weight_grams"),
    condition_notes: formData.get("condition_notes") ?? undefined,
    photo_paths: formData.getAll("photo_paths").map(String).filter(Boolean),
    flag_counterfeit: formData.get("flag_counterfeit") === "on",
  });
}

async function valuationFor(karat: number, weight: number) {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("system_settings")
    .select("price_24k, price_21k, price_18k, ltv_percent")
    .eq("id", 1)
    .single();
  if (!settings) return { error: "System settings are unavailable." as const };
  const valuation = calculateKaratValuation(weight, karat, settings, settings.ltv_percent);
  if (valuation.pricePerGram <= 0) {
    return { error: `The ${karat}K price per gram is not set. An Admin must set it in Settings first.` as const };
  }
  return { supabase, settings, valuation };
}

// Items 2, 3, 4, 9: save a calculator result into the available pool.
export async function createAppraisal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(["appraiser", "cashier", "admin"]);
  const parsed = parse(formData);
  if (!parsed.success) return validationFailure(parsed.error);
  const d = parsed.data;

  const v = await valuationFor(d.karat, d.weight_grams);
  if ("error" in v) return { error: v.error };

  const { data, error } = await v.supabase
    .from("appraisal_items")
    .insert({
      category: d.category,
      category_other: d.category === "others" ? d.category_other || null : null,
      karat: d.karat,
      weight_grams: d.weight_grams,
      condition_notes: d.condition_notes || null,
      photo_paths: d.photo_paths,
      gold_price_used: v.valuation.pricePerGram,
      ltv_percent_used: v.settings.ltv_percent,
      computed_value: v.valuation.value,
      suggested_loan_min: v.valuation.suggestedLoanMin,
      suggested_loan_max: v.valuation.suggestedLoanMax,
      is_counterfeit_risk: d.flag_counterfeit,
      counterfeit_resolution: d.flag_counterfeit ? "pending" : null,
      appraised_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/dashboard/appraisals");
  return { success: true, appraisalId: data.id };
}

// Appraisals stay editable until pawned (enforced by RLS + trigger).
export async function updateAppraisal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["appraiser", "admin"]);
  const id = String(formData.get("appraisal_id") ?? "");
  const parsed = parse(formData);
  if (!id) return { error: "Missing appraisal" };
  if (!parsed.success) return validationFailure(parsed.error);
  const d = parsed.data;

  const v = await valuationFor(d.karat, d.weight_grams);
  if ("error" in v) return { error: v.error };

  const { data, error } = await v.supabase
    .from("appraisal_items")
    .update({
      category: d.category,
      category_other: d.category === "others" ? d.category_other || null : null,
      karat: d.karat,
      weight_grams: d.weight_grams,
      condition_notes: d.condition_notes || null,
      gold_price_used: v.valuation.pricePerGram,
      ltv_percent_used: v.settings.ltv_percent,
      computed_value: v.valuation.value,
      suggested_loan_min: v.valuation.suggestedLoanMin,
      suggested_loan_max: v.valuation.suggestedLoanMax,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "This appraisal is already pawned or archived and can no longer be edited." };

  revalidatePath("/dashboard/appraisals");
  revalidatePath(`/dashboard/appraisals/${id}`);
  return { success: true, appraisalId: id };
}

// PB-16: Admin reviews a flagged item and clears or confirms the risk.
export async function resolveCounterfeitFlag(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const appraisalId = String(formData.get("appraisal_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!appraisalId || (decision !== "cleared" && decision !== "confirmed")) return { error: "Invalid resolution" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("appraisal_items")
    .update({ counterfeit_resolution: decision, counterfeit_resolved_by: user.id, counterfeit_resolved_at: new Date().toISOString() })
    .eq("id", appraisalId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/appraisals/${appraisalId}`);
  return { success: true, appraisalId };
}
