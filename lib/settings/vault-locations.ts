// VL (Nov 15, Settings → Vault locations, Phase 2). Counting the items stored in each location, the same way the
// Inventory page does, and the small rules the tab needs. Plain functions (no React), so they can be unit tested.
//
// Before: the tab read the items in ONE request (.limit(5000)). The database sends at most 1,000 rows per request,
// so the counts would silently stop at 1,000 items once the shop holds more. It also counted archived items and left
// out the items stored under old typed names (8 items today), so the tab showed 491 while Inventory showed 499.

import type { SupabaseClient } from "@supabase/supabase-js";

// "In the shop" = the Inventory page's In vault (pawned, renewed) + Forfeited + Queued for auction tabs, not archived.
// Released and sold items are not in the shop any more, so they are not counted.
export const IN_SHOP_STATUSES = ["pawned", "extended", "forfeited", "queued_for_auction"] as const;
type InShopStatus = (typeof IN_SHOP_STATUSES)[number];

export type StoredItem = { vault_location: string | null; status: string };

// the database sends at most 1,000 rows per request (same constant as the Inventory page)
const ROW_CHUNK = 1000;

/** Every item in the shop (location + status only), read 1,000 at a time so none is missed. Server side only. */
export async function readItemsInShop(supabase: SupabaseClient): Promise<StoredItem[]> {
  const all: StoredItem[] = [];
  for (let from = 0; ; from += ROW_CHUNK) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("vault_location, status")
      .is("archived_at", null)
      .in("status", [...IN_SHOP_STATUSES])
      .order("id")
      .range(from, from + ROW_CHUNK - 1);
    if (error) throw error;
    all.push(...((data ?? []) as StoredItem[]));
    if (!data || data.length < ROW_CHUNK) break;
  }
  return all;
}

// the same place whatever the capitals or spaces at the ends ("vault a " = "Vault A"), like the database's unique rule
export const locationKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

/** Spaces at the ends removed and repeated spaces inside made single ("  Vault   C " -> "Vault C"). */
export function cleanLocationName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type OtherLocation = { name: string; count: number; statuses: InShopStatus[] };

/**
 * Splits the items in the shop between the listed locations and the other (older, typed) names.
 * listed: count per listed location (by locationKey). other: every other name exactly as stored, with its count and
 * the statuses of its items (to link to the right Inventory tab). Names are never merged or changed.
 */
export function countByLocation(items: StoredItem[], listedNames: string[]) {
  const listedKeys = new Set(listedNames.map(locationKey));
  const listed = new Map<string, number>();
  const other = new Map<string, { count: number; statuses: Set<InShopStatus> }>();
  for (const it of items) {
    const key = locationKey(it.vault_location);
    if (listedKeys.has(key)) {
      listed.set(key, (listed.get(key) ?? 0) + 1);
    } else {
      const name = it.vault_location ?? "";
      const o = other.get(name) ?? { count: 0, statuses: new Set<InShopStatus>() };
      o.count += 1;
      o.statuses.add(it.status as InShopStatus);
      other.set(name, o);
    }
  }
  const others: OtherLocation[] = [...other.entries()]
    .map(([name, o]) => ({ name, count: o.count, statuses: [...o.statuses] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en", { numeric: true }));
  const listedTotal = [...listed.values()].reduce((s, n) => s + n, 0);
  const otherTotal = others.reduce((s, o) => s + o.count, 0);
  return { listed, others, listedTotal, otherTotal, total: listedTotal + otherTotal };
}

/** The Inventory tab that shows all of these items: In vault, Forfeited, Queued for auction, or All when mixed. */
export function inventoryTabFor(statuses: string[]): "vault" | "forfeited" | "auction" | "all" {
  const kinds = new Set(statuses.map((s) => (s === "pawned" || s === "extended" ? "vault" : s === "forfeited" ? "forfeited" : s === "queued_for_auction" ? "auction" : "other")));
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === "vault" || only === "forfeited" || only === "auction") return only;
  }
  return "all";
}

/** "1 item" / "335 items" (with thousands separators). */
export const itemsLabel = (n: number) => `${n.toLocaleString("en-PH")} ${n === 1 ? "item" : "items"}`;

/** The Switch off confirmation text, with the number of items recorded there now. */
export function switchOffMessage(count: number): string {
  const stored =
    count === 0
      ? "No items are currently recorded here."
      : `${itemsLabel(count)} ${count === 1 ? "is" : "are"} currently recorded here.`;
  return `${stored} Switching off stops this location from being offered for new loans. Existing items and their records stay exactly as they are, and you can switch it on again later.`;
}
