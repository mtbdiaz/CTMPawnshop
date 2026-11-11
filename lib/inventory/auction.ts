// AP1 (Nov 12, migration 0052): the Auction prep rules and words in one place (no database here, so they can be tested).
// Matt's flow is the same: forfeited item -> auction batch -> queued -> sale recorded -> sold.
// The database checks every rule again; these only decide what the screen shows and catch typing mistakes early.
import { categoryLabel } from "@/lib/appraisal/valuation"; // "ring" -> "Ring"
import { appraisalNo } from "@/lib/ref-numbers"; // 45 -> "A-0045"

// 7 -> "AB-0007": the number each auction batch gets, so staff can say which batch they mean
export const batchNo = (n: number | null | undefined) => (n ? `AB-${String(n).padStart(4, "0")}` : "");

// The reserve (minimum) price of an item in a batch has three states. Before 0052 an empty box quietly meant
// "no minimum"; now "nobody decided yet" and "no minimum on purpose" are different things.
export type ReserveState = "not_set" | "no_reserve" | "price";
export const reserveState = (minPrice: number | null | undefined, noReserve: boolean | null | undefined): ReserveState =>
  noReserve ? "no_reserve" : minPrice != null && Number(minPrice) > 0 ? "price" : "not_set";

// A typed peso amount ("5,000" or "5000.50") -> a number, or null when it isn't a valid amount.
// More than 0, at most 10,000,000, at most 2 decimals (the same limits the database uses).
export function parsePeso(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; // letters, a minus sign, 3 decimals...
  const n = Number(s);
  return n > 0 && n <= 10_000_000 ? n : null;
}

// What is wrong with one item's reserve choice in the Prepare form (null = fine).
export function reserveProblem(price: string, noReserve: boolean): string | null {
  if (noReserve) return price.trim() ? 'Clear the price or untick "No reserve". Pick one.' : null;
  if (!price.trim()) return 'Enter a reserve price, or tick "No reserve".';
  return parsePeso(price) === null ? "Enter an amount in pesos, like 5000 or 5000.50." : null;
}

// the item fields every auction list shows
export type AuctionItemInfo = {
  appraisal_item_id: string | null;
  appraisal_no: number | null;
  category: string | null;
  category_other: string | null;
  karat: number | null;
  weight_grams: number | null;
  computed_value: number | null; // the appraised value (a guide only, never used as the reserve by itself)
  photo_count: number;
  customer_name: string | null;
  vault_location: string | null;
  loan_id: string | null;
  ticket_number: string | null;
  audit_flag: "not_located" | "found_elsewhere" | null; // from the last submitted physical audit, not followed up yet
};

// "Ring, 18K, 2 g"
export const itemTitle = (a: Pick<AuctionItemInfo, "category" | "category_other" | "karat" | "weight_grams">) =>
  a.category ? `${categoryLabel(a.category, a.category_other)}, ${a.karat ?? "?"}K, ${a.weight_grams ?? "?"} g` : "Item";
// "A-0045", or "" when the item has no appraisal number
export const itemRef = (a: Pick<AuctionItemInfo, "appraisal_no">) => (a.appraisal_no ? appraisalNo(a.appraisal_no) : "");

// FI1: the appraised value in words. A missing value is NEVER shown as ₱0.00 (that would look like a real amount).
export const appraisedText = (v: number | null | undefined) =>
  v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "not available";

// FI1: is everything there that is needed to know WHICH piece of jewelry this is? (type, karat, weight, A-number, ticket)
export const identityMissing = (a: Pick<AuctionItemInfo, "appraisal_item_id" | "category" | "karat" | "weight_grams" | "appraisal_no" | "ticket_number">) =>
  !a.appraisal_item_id || !a.category || a.karat == null || a.weight_grams == null || !a.appraisal_no || !a.ticket_number;

// one forfeited item on the Prepare items tab (from auction_prepare_list)
export type PrepareItem = AuctionItemInfo & {
  id: string; // the vault item
  loan_status: string | null;
  forfeited_at: string | null;
  in_open_batch: boolean;
  last_unsold: { batch_no: number; at: string; reason: string; min_price: number | null; no_reserve: boolean } | null;
};

// Can this forfeited item go into a batch? The same checks the database does in create_auction_batch.
// "ok" means the SYSTEM's checks passed. It does not mean the legal steps (notice, publication) were done.
// "ok: false" items can't be ticked and are never part of "Select all".
export function eligibility(
  i: Pick<PrepareItem, "loan_status" | "audit_flag" | "in_open_batch"> & Partial<Pick<PrepareItem, "appraisal_item_id" | "category" | "karat" | "weight_grams" | "appraisal_no" | "ticket_number">>,
): { ok: boolean; label: string; tone: "info" | "warning" | "danger"; why: string } {
  // FI1: an item whose details did not load can't be ticked: nobody could check it is the right piece
  if ("category" in i && identityMissing(i as PrepareItem))
    return { ok: false, label: "Blocked: details missing", tone: "danger", why: "Its appraisal details or pawn ticket could not be loaded. Reload the page; if it stays like this, tell an Admin." };
  if (i.loan_status !== "forfeited") return { ok: false, label: "Blocked: loan not forfeited", tone: "danger", why: "Its loan is not forfeited by an Admin." };
  if (i.in_open_batch) return { ok: false, label: "Blocked: already in a batch", tone: "danger", why: "It is already waiting in an auction batch." };
  if (i.audit_flag === "not_located")
    return { ok: false, label: "Blocked: not located", tone: "danger", why: "The last physical audit could not find it. Follow that up on the Physical audit page first." };
  if (i.audit_flag === "found_elsewhere")
    return { ok: true, label: "Checks passed, verify location", tone: "warning", why: "The last physical audit found it in a different place. Check where it is before the auction." };
  // HR1: not "Eligible" in green. The system only checks its own records; the auction notice and publication are not
  // tracked here, so the badge must not read as a legal approval.
  return { ok: true, label: "System checks passed", tone: "info", why: "Forfeited by an Admin, records complete, not in another batch, no open audit problem. Notice and publication are not checked here." };
}

// one line of a batch (from auction_lines): an item, its reserve, and what happened to it
export type AuctionLine = AuctionItemInfo & {
  id: string; // the batch line
  batch_id: string;
  batch_no: number;
  batch_at: string;
  batch_notes: string | null;
  auction_date: string | null;
  min_price: number | null;
  no_reserve: boolean;
  sold_at: string | null;
  sale_price: number | null;
  buyer_name: string | null;
  sale_notes: string | null;
  sold_by_name: string | null;
  unsold_at: string | null;
  unsold_reason: string | null;
  unsold_by_name: string | null;
  inventory_item_id: string;
  item_status: string;
  // 0053: auction-sale money the cash ledger ALREADY has for this ticket while the item is still waiting (null = none).
  // When set, the database refuses a sale, so the same money is never put in the ledger twice.
  ledger_sale: number | null;
};
export type AuctionLinePage = { total: number; sum: number; page: number; size: number; rows: AuctionLine[] };

// what happened to a line: still waiting, sold, or not sold (went back to Forfeited)
export function lineOutcome(l: Pick<AuctionLine, "sold_at" | "unsold_at">): { key: "queued" | "sold" | "unsold"; label: string; tone: "warning" | "success" | "neutral" } {
  if (l.sold_at) return { key: "sold", label: "Sold", tone: "success" };
  if (l.unsold_at) return { key: "unsold", label: "Not sold", tone: "neutral" };
  return { key: "queued", label: "Queued", tone: "warning" };
}

// A batch's status, worked out from its lines (there is no status column; nothing is stored twice).
export function batchStatus(c: { items: number; sold: number; unsold: number }): { label: string; tone: "warning" | "success" | "neutral" } {
  const waiting = c.items - c.sold - c.unsold;
  if (c.items === 0) return { label: "Empty", tone: "neutral" };
  if (waiting === c.items) return { label: "Open", tone: "warning" }; // nothing recorded yet
  if (waiting > 0) return { label: "In progress", tone: "warning" }; // some sold or unsold, some still waiting
  return { label: "Closed", tone: c.sold > 0 ? "success" : "neutral" }; // every item has an outcome
}

// What is wrong with the Record sale form (field -> message); empty = fine. The database checks all of it again.
export function saleProblems(price: string, buyer: string, notes: string, confirmed: boolean, minPrice: number | null): Record<string, string> {
  const e: Record<string, string> = {};
  const n = parsePeso(price);
  if (n === null) e.sale_price = "Enter the sale price in pesos, like 15000 or 15000.50.";
  else if (minPrice != null && n < minPrice) e.sale_price = "The sale price is below this item's reserve price.";
  if (buyer.trim().length < 2) e.buyer_name = "Write the buyer's name.";
  else if (buyer.trim().length > 120) e.buyer_name = "Keep the buyer name to 120 characters or less.";
  if (notes.trim().length > 500) e.sale_notes = "Keep the note to 500 characters or less.";
  if (!confirmed) e.confirm = "Tick both boxes: the payment was received in full, and the item was handed to the buyer.";
  return e;
}
