"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { appraisalSchema } from "@/lib/validation/appraisal";
import { validationFailure, type FieldErrors } from "@/lib/validation/errors";
import { calculateKaratValuation } from "@/lib/appraisal/valuation";
import { compareAppraisal } from "@/lib/appraisal/edit"; // A2/A3: what an edit really changed
import type { TablesUpdate } from "@/lib/supabase/database.types";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; appraisalId?: string; message?: string }; // message: A2/A3 success text that depends on what was saved

// A5: plain words for staff. The technical details go to the server log only.
const TRY_AGAIN = "Please try again. If it keeps happening, tell an Admin.";
const CHANGED_WHILE_EDITING = "Someone changed this appraisal while you had it open, so nothing was saved. Reload the page and check the latest details.";

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
  if (!settings) return { error: `Couldn't read the gold prices from Settings, so nothing was saved. ${TRY_AGAIN}` as const }; // A5
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
  if (error) {
    console.error("createAppraisal failed:", error.message); // A5: details stay in the server log
    return { error: `Couldn't save the appraisal, so nothing was saved. ${TRY_AGAIN}` }; // A5: plain message
  }

  revalidatePath("/dashboard/appraisals");
  return { success: true, appraisalId: data.id };
}

// Appraisals stay editable until pawned (enforced by RLS + trigger).
// A2: an unchanged save does nothing, and only a karat or weight change
// re-prices. A3: a material change on a cleared item needs an Admin and sends
// the flag back to review. A4: confirmed-risk items can't be edited.
export async function updateAppraisal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(["appraiser", "admin"]);
  const id = String(formData.get("appraisal_id") ?? "");
  const loadedAt = String(formData.get("updated_at") ?? ""); // when the form was opened, to catch someone else's change
  const parsed = parse(formData);
  if (!id) return { error: "Appraisal not found. Reload the page." };
  if (!parsed.success) return validationFailure(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("appraisal_items")
    .select("category, category_other, karat, weight_grams, condition_notes, status, archived_at, is_counterfeit_risk, counterfeit_resolution, updated_at")
    .eq("id", id)
    .maybeSingle(); // read what is saved now, to compare with the form
  if (readError) {
    console.error("updateAppraisal read failed:", readError.message); // A5
    return { error: `Couldn't load the appraisal, so nothing was saved. ${TRY_AGAIN}` };
  }
  if (!current) return { error: "Appraisal not found. It may have been archived." };
  if (current.status !== "available" || current.archived_at) {
    return { error: "This appraisal is already pawned or archived, so it can no longer be edited." };
  }
  if (current.is_counterfeit_risk && current.counterfeit_resolution === "confirmed") {
    return { error: "An Admin confirmed this item as a counterfeit risk, so it can't be edited. Archive it instead." }; // A4
  }
  if (loadedAt && loadedAt !== current.updated_at) return { error: CHANGED_WHILE_EDITING }; // someone saved first

  const next = {
    category: d.category,
    category_other: d.category === "others" ? d.category_other || null : null, // the description only applies to Others
    karat: d.karat,
    weight_grams: d.weight_grams,
    condition_notes: d.condition_notes || null,
  };
  const change = compareAppraisal(current, next); // A2: what is really different
  if (!change.any) return { error: "Nothing changed, so nothing was saved." }; // A2: no silent re-price

  const wasCleared = current.is_counterfeit_risk && current.counterfeit_resolution === "cleared";
  if (wasCleared && change.material && user.profile.role !== "admin") {
    // A3: the Admin cleared the item as it was. A different karat, weight or category is a different item.
    return { error: "An Admin cleared this item's counterfeit flag. Only an Admin can change its karat, weight or category, and the item will be checked again." };
  }

  const update: TablesUpdate<"appraisal_items"> = { ...next }; // A2: descriptive fields always save
  if (change.reprice) {
    const v = await valuationFor(d.karat, d.weight_grams); // A2: only karat or weight re-price, at today's price
    if ("error" in v) return { error: v.error };
    Object.assign(update, {
      gold_price_used: v.valuation.pricePerGram,
      ltv_percent_used: v.settings.ltv_percent,
      computed_value: v.valuation.value,
      suggested_loan_min: v.valuation.suggestedLoanMin,
      suggested_loan_max: v.valuation.suggestedLoanMax,
    });
  }
  const backToReview = wasCleared && change.material; // A3: only an Admin can reach this line
  if (backToReview) Object.assign(update, { counterfeit_resolution: "pending", counterfeit_resolved_by: null, counterfeit_resolved_at: null });

  const { data, error } = await supabase
    .from("appraisal_items")
    .update(update)
    .eq("id", id)
    .eq("updated_at", current.updated_at) // only if nobody saved in between
    .select("id");
  if (error) {
    console.error("updateAppraisal failed:", error.message); // A5
    return { error: `Couldn't save the changes, so nothing was changed. ${TRY_AGAIN}` };
  }
  if (!data?.length) return { error: CHANGED_WHILE_EDITING }; // pawned, archived or edited by someone else just now

  revalidatePath("/dashboard/appraisals");
  revalidatePath(`/dashboard/appraisals/${id}`);
  const message = backToReview
    ? "Saved. The karat, weight or category changed, so the item is back to counterfeit review."
    : change.reprice
      ? "Saved. Value and maximum loan recalculated at today's price."
      : "Saved. Value and maximum loan unchanged."; // A2: say what happened to the value
  return { success: true, appraisalId: id, message };
}

// PB-16: Admin reviews a flagged item and clears or confirms the risk.
export async function resolveCounterfeitFlag(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const appraisalId = String(formData.get("appraisal_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!appraisalId || (decision !== "cleared" && decision !== "confirmed")) return { error: "Choose Clear flag or Confirm risk." }; // A5
  // #28: why the Admin decided (required, 5 to 500 characters), saved with the decision and shown on the appraisal page
  const notes = String(formData.get("resolution_notes") ?? "").trim();
  if (notes.length < 5) return { error: "Write why you decided (at least 5 characters).", fieldErrors: { resolution_notes: "Write why you decided (at least 5 characters)." } };
  if (notes.length > 500) return { fieldErrors: { resolution_notes: "Keep the reason to 500 characters or less." } };

  const loadedAt = String(formData.get("updated_at") ?? ""); // the version the Admin looked at

  const supabase = await createClient();
  let query = supabase
    .from("appraisal_items")
    .update({ counterfeit_resolution: decision, counterfeit_resolved_by: user.id, counterfeit_resolved_at: new Date().toISOString(), counterfeit_resolution_notes: notes })
    .eq("id", appraisalId)
    .eq("counterfeit_resolution", "pending"); // only a flag that is still waiting
  if (loadedAt) query = query.eq("updated_at", loadedAt); // not if the item was edited after the Admin opened it
  const { data, error } = await query.select("id");
  if (error) {
    console.error("resolveCounterfeitFlag failed:", error.message); // A5
    return { error: `Couldn't save the decision, so nothing was changed. ${TRY_AGAIN}` };
  }
  if (!data?.length) return { error: "This item changed or was already reviewed while you had it open, so nothing was saved. Reload the page and check it again." };

  revalidatePath(`/dashboard/appraisals/${appraisalId}`);
  return { success: true, appraisalId };
}
