"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import { parsePeso, reserveProblem, saleProblems } from "@/lib/inventory/auction"; // AP1: the auction typing checks
import { AUDIT_RESULTS, auditResultProblem, followupProblems, type AuditResult } from "@/lib/inventory/audit"; // AS1: the audit results and their checks

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; id?: string };

// ---------- Physical audit (PB-25), as a saved session (AS1, migrations 0044 + 0045) ----------
// Before: one big form with every item ticked "Found" from the start, saved only when Submit was pressed.
// Now: Start makes the audit in the database with every item "Not checked"; each result is saved the moment it is
// picked; Submit closes it. The database checks the role (Operator or Admin) and every rule again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // the shape of a database id

// Start an audit for one vault location, or for all of them. If that location already has an open audit,
// the database gives back that one (two people never get two audits of the same shelf).
export async function startAudit(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const scope = String(formData.get("scope") ?? "").trim(); // "" = all locations
  const requestId = String(formData.get("request_id") ?? ""); // the same Start pressed twice = one audit
  if (scope.length > 120) return { error: "Pick a location from the list." };
  const overlapReason = formData.get("allow_overlap") === "on" ? String(formData.get("overlap_reason") ?? "").trim() : ""; // only with the tick
  if (formData.get("allow_overlap") === "on" && overlapReason.length < 5) return { fieldErrors: { overlap_reason: "Write why a separate audit is needed (at least 5 characters)." } };
  if (overlapReason.length > 300) return { fieldErrors: { overlap_reason: "Keep the reason to 300 characters or less." } };

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("start_inventory_audit", {
    p_scope: scope || undefined, // left out = all locations
    p_request_id: UUID.test(requestId) ? requestId : undefined,
    // DD1 (0048 + 0049): another open audit already lists some of these items. That is allowed (a spot check during
    // a full count) but only on purpose: the person writes why. Without a reason the database refuses.
    p_overlap_reason: overlapReason || undefined,
  });
  // e.g. "There are no items in Safe 9 to audit." / "An audit that lists the same items is already in progress (...)"
  if (error || !id) return { error: (error?.message ?? "Could not start the audit.").replace(/^OVERLAP: /, "") };

  revalidatePath("/dashboard/inventory/audit");
  return { success: true, id }; // the page opens the audit with this id
}

// what the checklist sends for ONE item
export type AuditResultInput = {
  lineId: string; // the audit line (one item in one audit)
  result: AuditResult; // not_checked | found | found_elsewhere | not_located
  version: number; // the line's version the screen has; an older one is refused, so nobody overwrites someone else
  reason?: string; // for Not located
  note?: string; // optional words
  place?: string; // for Found elsewhere: where it really was
};
export type AuditResultState =
  | { ok: true; version: number } // saved; the new version
  | { ok: false; error: string; stale?: boolean }; // stale = someone else changed this item first

// Save the result of one item, right when it is picked (this is the "draft": nothing waits for a Save button).
// It only writes the audit line. It never changes the item, the loan or the custody status.
export async function saveAuditResult(input: AuditResultInput): Promise<AuditResultState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("audit"))) return { ok: false, error: TOO_MANY }; // 300 checks a minute per account
  if (!UUID.test(input.lineId) || !Number.isInteger(input.version)) return { ok: false, error: "This item is not in the audit. Reload the page." };
  if (!AUDIT_RESULTS.some((r) => r.value === input.result)) return { ok: false, error: "Pick one of the results." };
  const problem = auditResultProblem(input.result, input.reason ?? "", input.note ?? "", input.place ?? ""); // the same checks as the screen
  if (problem) return { ok: false, error: problem };

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("record_audit_result", {
    p_line: input.lineId,
    p_result: input.result,
    p_version: input.version,
    p_reason: input.result === "not_located" ? input.reason : undefined,
    p_note: input.result === "not_located" || input.result === "found_elsewhere" ? input.note?.trim() || undefined : undefined,
    p_found_location: input.result === "found_elsewhere" ? input.place?.trim() : undefined,
  });
  if (error || typeof version !== "number") {
    const message = error?.message ?? "Could not save. Try again.";
    return { ok: false, error: message, stale: message.startsWith("Someone else updated this item") };
  }
  return { ok: true, version }; // no page reload: the checklist updates its own numbers
}

export type AuditSubmitState = { ok: true; partial: boolean; unchecked: number } | { ok: false; error: string };

// Close the audit. partial = false: refused while items are still Not checked. partial = true: allowed, and the
// audit is labelled "Partial" with the number left. Pressing it twice (or from two tabs) saves it once.
export async function submitAuditSession(auditId: string, partial: boolean, notes: string): Promise<AuditSubmitState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { ok: false, error: TOO_MANY };
  if (!UUID.test(auditId)) return { ok: false, error: "Audit not found. Reload the page." };
  if (notes.trim().length > 1000) return { ok: false, error: "Keep the audit note to 1000 characters or less." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_audit_session", { p_audit: auditId, p_partial: partial, p_notes: notes.trim() || undefined });
  if (error) return { ok: false, error: error.message }; // e.g. "12 items are still not checked. ..."
  const unchecked = Number((data as { unchecked?: number } | null)?.unchecked ?? 0);

  revalidatePath("/dashboard/inventory/audit");
  revalidatePath(`/dashboard/inventory/audit/${auditId}`);
  return { ok: true, partial: partial && unchecked > 0, unchecked };
}

// Throw away a draft that was started by mistake. It is not deleted: it is marked discarded with who, when and why,
// and its checks are kept. Only the person who started it, or an Admin (the database checks). A draft with saved
// checks needs the extra tick. A submitted audit can't be discarded. (DD1, migration 0048)
export async function discardAudit(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };
  const auditId = String(formData.get("audit_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(auditId)) return { error: "Audit not found. Reload the page." };
  if (reason.length < 5) return { fieldErrors: { reason: "Write why (at least 5 characters)." } };
  if (reason.length > 300) return { fieldErrors: { reason: "Keep the reason to 300 characters or less." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_audit_session", { p_audit: auditId, p_reason: reason, p_confirm_checks: formData.get("confirm_checks") === "on" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/inventory/audit");
  return { success: true };
}

// The appraisal photos of one item, as links that work for 10 minutes. Loaded only when a person presses
// "Show photos" on an item, so the checklist itself stays light.
export async function auditItemPhotos(appraisalItemId: string): Promise<{ urls: string[]; error?: string }> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("search"))) return { urls: [], error: TOO_MANY };
  if (!UUID.test(appraisalItemId)) return { urls: [], error: "Item not found." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("appraisal_items").select("photo_paths").eq("id", appraisalItemId).maybeSingle();
  if (error || !data) return { urls: [], error: "Could not load the photos." };
  const urls = await Promise.all(
    (data.photo_paths ?? []).map(async (path) => (await supabase.storage.from("item-photos").createSignedUrl(path, 600)).data?.signedUrl ?? null),
  );
  const ok = urls.filter((u): u is string => Boolean(u)); // leave out any photo that could not be opened
  return ok.length || !urls.length ? { urls: ok } : { urls: [], error: "Could not load the photos." };
}

// PB-26 + UC18 + AP1 (migration 0052): put forfeited items in an auction batch.
// Before: an empty minimum price quietly meant "no minimum". Now every ticked item needs a reserve price OR a
// deliberate "No reserve" tick. Also new: an optional auction date and place, and a one-time request id so a
// double click makes one batch. The database checks everything again (forfeited by an Admin, not already in a
// batch, not "Not located" in the last physical audit) at the moment of saving.
export async function createAuctionBatch(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const itemIds = formData.getAll("item_id").map(String);
  const notes = String(formData.get("notes") ?? "").trim();
  const place = String(formData.get("auction_place") ?? "").trim();
  const date = String(formData.get("auction_date") ?? "").trim(); // "2026-11-30" or ""
  const requestId = String(formData.get("request_id") ?? "");
  if (itemIds.length === 0) return { error: "Select at least one forfeited item" };
  if (itemIds.some((id) => !UUID.test(id)) || new Set(itemIds).size !== itemIds.length) return { error: "Reload the page and select the items again." };
  if (itemIds.length > 200) return { error: "A batch can have at most 200 items. Make a second batch for the rest." };

  // each ticked item: a reserve price, or the "No reserve" tick (never both, never neither)
  const fieldErrors: FieldErrors = {};
  const minPrices: (number | null)[] = [];
  const noReserve: boolean[] = [];
  for (const id of itemIds) {
    const raw = String(formData.get(`min_price_${id}`) ?? "");
    const none = formData.get(`no_reserve_${id}`) === "on";
    const problem = reserveProblem(raw, none);
    if (problem) fieldErrors[`min_price_${id}`] = problem;
    minPrices.push(none ? null : parsePeso(raw));
    noReserve.push(none);
  }
  if (notes.length > 500) fieldErrors.notes = "Keep the batch note to 500 characters or less.";
  if (place.length > 120) fieldErrors.auction_place = "Keep the auction place to 120 characters or less.";
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fieldErrors.auction_date = "Pick a date from the calendar.";
  if (Object.keys(fieldErrors).length) return { error: "Check the reserve prices: each selected item needs a price or \"No reserve\".", fieldErrors };

  // One database call: the batch, its items (with their reserves) and the status change are saved together, or not at all.
  const supabase = await createClient();
  const { data: batchId, error } = await supabase.rpc("create_auction_batch", {
    p_item_ids: itemIds,
    p_notes: notes || undefined,
    p_min_prices: minPrices,
    p_no_reserve: noReserve,
    p_auction_date: date || undefined,
    p_auction_place: place || undefined,
    p_request_id: UUID.test(requestId) ? requestId : undefined, // the same Create sent twice = one batch
  });
  if (error || !batchId) return { error: error?.message ?? "Could not create the batch" };

  revalidatePath("/dashboard/inventory/auction", "layout"); // the page and the batch pages under it
  revalidatePath("/dashboard/inventory");
  return { success: true, id: batchId };
}

// AP1: set the reserve of an item that is already queued. The 53 items queued before migration 0052 have
// "Not set"; one of these must be saved before the item can be sold. An Operator can set it once;
// changing a reserve that is already set is for an Admin (the database checks this).
export async function setReserve(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };
  const lineId = String(formData.get("line_id") ?? "");
  const raw = String(formData.get("min_price") ?? "");
  const none = formData.get("no_reserve") === "on";
  if (!UUID.test(lineId)) return { error: "Missing item. Reload the page and try again." };
  const problem = reserveProblem(raw, none);
  if (problem) return { fieldErrors: { min_price: problem } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auction_reserve", { p_line: lineId, p_min_price: none ? null : parsePeso(raw), p_no_reserve: none });
  if (error) return { error: error.message }; // plain messages from the database ("Only an Admin can change it.")
  revalidatePath("/dashboard/inventory/auction", "layout"); // the page and the batch pages under it
  return { success: true };
}

// #43 + UC16 + AP1: record that a queued item was sold. Still ONE step, as Matt built it: the item becomes Sold
// and the money goes in the cash ledger. New in 0052: the buyer's name is required, the person must tick (separately) that the
// payment was received in full and that the item was handed over, and an item whose reserve is "Not set" is refused.
export async function recordSale(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const itemId = String(formData.get("item_id") ?? "");
  const raw = String(formData.get("sale_price") ?? "");
  const buyer = String(formData.get("buyer_name") ?? "").trim();
  const notes = String(formData.get("sale_notes") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "");
  if (!UUID.test(itemId)) return { error: "Missing item. Reload the page and try again." };

  // the reserve is checked by the database (it knows the real one); here only the typing and the confirmation
  // SR1: payment and handover are two different things, so they are two ticks. Both are needed, because "Sold" in this
  // system means the money is in and the item has left the shop (there is no "paid but not released yet" state).
  const confirmed = formData.get("confirm_payment") === "on" && formData.get("confirm_handover") === "on";
  const fieldErrors: FieldErrors = saleProblems(raw, buyer, notes, confirmed, null);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_auction_sale", {
    p_item_id: itemId,
    p_sale_price: parsePeso(raw) as number,
    p_buyer: buyer,
    p_notes: notes || undefined,
    p_request_id: UUID.test(requestId) ? requestId : undefined, // the same form sent twice = one sale
  });
  if (error) return { error: error.message }; // the database's messages are plain ("below this item's minimum price (₱5,000.00)")

  revalidatePath("/dashboard/inventory/auction", "layout"); // the page and the batch pages under it
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/finance"); // the sale shows in the cash ledger
  return { success: true };
}

// AP1: the item did not sell. Before, it stayed "Queued" forever. Now it goes back to Forfeited (still in the
// vault, ready for a later batch) and the old batch keeps the line with the reason. No money is recorded.
export async function markUnsold(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };
  const itemId = String(formData.get("item_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(itemId)) return { error: "Missing item. Reload the page and try again." };
  if (reason.length < 5) return { fieldErrors: { reason: "Write why it was not sold (at least 5 characters)." } };
  if (reason.length > 300) return { fieldErrors: { reason: "Keep the reason to 300 characters or less." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_auction_unsold", { p_item_id: itemId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/inventory/auction", "layout"); // the page and the batch pages under it
  revalidatePath("/dashboard/inventory");
  return { success: true };
}

// #14 + AD1 (migration 0046): "Review discrepancy" for an item with a problem in a submitted audit.
// Before: "Mark found" with one note closed it. Now the person says what they found when they checked again:
//   found_expected (closes the follow-up) or found_elsewhere / still_not_located / escalated (stays open; 0047).
// Every check is saved as its own row with who and when. The audit's own result is never rewritten, and the item's
// location, custody status and loan are not changed here.
export async function reviewDiscrepancy(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const lineId = String(formData.get("line_id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const place = String(formData.get("found_location") ?? "").trim();
  const seen = Number(formData.get("seen")); // how many earlier checks the popup showed
  if (!UUID.test(lineId) || !Number.isInteger(seen)) return { error: "Missing audit line. Reload the page and try again." };

  const problems = followupProblems(outcome, notes, place, formData.get("confirm") === "on"); // the same checks as the database
  if (Object.keys(problems).length) return { fieldErrors: problems };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_audit_discrepancy", {
    p_line: lineId,
    p_outcome: outcome,
    p_notes: notes,
    p_found_location: outcome === "found_elsewhere" ? place : undefined,
    p_seen: seen,
  });
  if (error) return { error: error.message }; // plain words from the database, e.g. "Someone else added a follow-up ..."

  revalidatePath("/dashboard/inventory/audit");
  return { success: true, id: outcome }; // the popup uses the outcome for its message
}

// ---------- Move an item to another vault location (VL1, migration 0075) ----------
// Before: an item's location was typed once when the loan was made and could never be changed in the app (the 8 items
// under old names like "123" or "Vault A - Shelf 2" stayed there for ever).
// Now: an Operator or Admin picks a location from the list (switched on) and writes why. The database checks everything
// again: the role, that the item is in the shop, that nobody moved it since the page was opened, the destination, the
// reason, and that the item is not in an open Physical audit. The move is saved with who, when, from, to and why.
export async function moveItem(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const item = String(formData.get("item_id") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const expectedFrom = String(formData.get("expected_from") ?? ""); // the location the popup showed (kept exactly)
  const requestId = String(formData.get("request_id") ?? ""); // the same Move pressed twice = one move
  if (!UUID.test(item)) return { error: "This item could not be found. Reload the page." };
  if (!to || to.length > 40) return { fieldErrors: { to: "Choose the location the item is moved to." } };
  if (reason.length < 5) return { fieldErrors: { reason: "Write why the item is moved (at least 5 characters)." } };
  if (reason.length > 300) return { fieldErrors: { reason: "Keep the reason to 300 characters or less." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_inventory_item", {
    p_item: item,
    p_to: to,
    p_reason: reason,
    p_expected_from: expectedFrom,
    p_request_id: UUID.test(requestId) ? requestId : undefined,
  });
  // e.g. "This item is in an open Physical audit (c574a807). Submit or discard that audit first, then move the item."
  if (error) return { error: error.message || "Could not move the item." };

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/settings"); // the item counts on Settings → Vault locations
  return { success: true };
}
