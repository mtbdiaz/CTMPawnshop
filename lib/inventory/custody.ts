// V1: Vault Inventory rules in one place (no database here, so they can be tested).
// An item has two separate things, like a loan does:
//   1. its CUSTODY: is the physical item still in the shop? (from inventory_items.status)
//   2. its LOAN: the loan's own state (Active, Renewed, Defaulted...), shown with the Loans page badges
// Nothing here changes a record; it only decides what the screen shows.
import { daysUntilDue } from "@/lib/compliance/reminders"; // whole calendar days between two dates
import { ITEM_CATEGORIES, KARATS } from "@/lib/appraisal/valuation"; // the item types and karats the shop uses

export type InventoryStatus = "pawned" | "extended" | "redeemed" | "forfeited" | "queued_for_auction" | "sold"; // "sold" since migration 0030 (UC16)

// what each database status means for the PHYSICAL item. "where" = where the item is now
export const CUSTODY: Record<InventoryStatus, { label: string; where: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  pawned: { label: "In vault", where: "In the vault, pledged for a running loan", tone: "success" },
  extended: { label: "In vault", where: "In the vault, the loan was renewed", tone: "success" },
  forfeited: { label: "Forfeited", where: "Still in the vault; now shop property", tone: "danger" },
  queued_for_auction: { label: "Queued for auction", where: "Still in the vault until it is sold", tone: "warning" },
  redeemed: { label: "Released", where: "Given back to the customer", tone: "neutral" },
  sold: { label: "Sold", where: "Sold at auction; no longer in the shop", tone: "neutral" }, // #43 / UC16
};

// the words for a status change in the history ("Renewed Oct 12")
export const CHANGE_WORDS: Record<InventoryStatus, string> = {
  pawned: "Pawned",
  extended: "Renewed",
  redeemed: "Released",
  forfeited: "Forfeited",
  queued_for_auction: "Queued for auction",
  sold: "Sold",
};

/** The Manila calendar day (YYYY-MM-DD) of a saved time, e.g. 2026-11-07T16:30:00Z is Nov 8 in Manila. */
export function manilaDateOf(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // en-CA = YYYY-MM-DD
}

/** True while the physical item is still in the shop (everything except Released and Sold). */
export function stillInShop(status: string): boolean {
  return status !== "redeemed" && status !== "sold";
}

/**
 * Days held, in Manila calendar days: from the day the item came in (the loan was made) up to today,
 * or up to the day it was released, so a released item stops counting.
 * receivedAt / releasedAt are saved times (timestamps); today is a Manila date (YYYY-MM-DD).
 */
export function daysHeld(receivedAt: string, today: string, releasedAt?: string | null): number {
  const start = manilaDateOf(receivedAt); // the Manila day it came in
  const end = releasedAt ? manilaDateOf(releasedAt) : today; // released items stop on the release day
  return Math.max(0, -daysUntilDue(start, end)); // whole calendar days between the two
}

/**
 * From the item's status history rows: when it got its CURRENT status (newest change to that status), and the
 * release time (if any). If the history has no entry for the current status (old demo data), `since` is null and
 * nothing is shown, so the date never contradicts the badge.
 */
export function historySummary(rows: { new_status: string; changed_at: string }[], currentStatus: string) {
  const sorted = [...rows].sort((a, b) => b.changed_at.localeCompare(a.changed_at)); // newest first (ISO times sort as text)
  return {
    since: sorted.find((r) => r.new_status === currentStatus) ?? null, // when it got the status it has now
    // when it left the shop: released to the customer, or sold at auction (#43)
    releasedAt: sorted.find((r) => r.new_status === "redeemed" || r.new_status === "sold")?.changed_at ?? null,
  };
}

/**
 * V1: splits a search into item words and the rest.
 * "chain 18k" -> category chain + karat 18 (exact filters, like the Category dropdown);
 * anything else ("PT-2026", "Reyes", "0917", "Safe 1") is searched as ticket, pawner or location.
 */
export function parseInventorySearch(q: string) {
  let category: string | null = null;
  let karat: number | null = null;
  const rest: string[] = [];
  for (const word of q.trim().split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase().replace(/s$/, ""); // "chains" -> "chain", "rings" -> "ring"
    const cat = ITEM_CATEGORIES.find((c) => c.value === lower || c.label.toLowerCase() === lower || (c.value === "earrings" && lower === "earring"));
    const k = /^(\d{2})k$/i.exec(word); // "18k" / "18K"
    if (!category && cat && cat.value !== "others") category = cat.value; // "others" is too common a word to treat as a type
    else if (!karat && k && (KARATS as readonly number[]).includes(Number(k[1]))) karat = Number(k[1]);
    else rest.push(word);
  }
  return { category, karat, text: rest.join(" ") };
}
