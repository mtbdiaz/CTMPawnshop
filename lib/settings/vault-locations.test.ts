import { describe, expect, it } from "vitest";
import { cleanLocationName, countByLocation, inventoryTabFor, itemsLabel, switchOffMessage, type StoredItem } from "./vault-locations";

describe("cleanLocationName (VL8)", () => {
  it("removes spaces at the ends and makes repeated spaces single", () => {
    expect(cleanLocationName("  Vault   C ")).toBe("Vault C");
    expect(cleanLocationName("Safe\t2")).toBe("Safe 2");
    expect(cleanLocationName("Vault A")).toBe("Vault A");
  });
});

describe("countByLocation (VL3, VL4)", () => {
  const items: StoredItem[] = [
    ...Array.from({ length: 3 }, () => ({ vault_location: "Vault A", status: "pawned" })),
    { vault_location: "vault a", status: "extended" }, // other capitals = the same listed place
    { vault_location: "Safe 1", status: "forfeited" },
    { vault_location: "123", status: "pawned" },
    { vault_location: "Vault A - Shelf 2", status: "extended" },
    { vault_location: "Vault A - Shelf 2", status: "queued_for_auction" },
  ];

  it("counts listed locations case-insensitively and keeps other names exactly as stored", () => {
    const r = countByLocation(items, ["Vault A", "Vault B", "Safe 1"]);
    expect(r.listed.get("vault a")).toBe(4);
    expect(r.listed.get("safe 1")).toBe(1);
    expect(r.listed.get("vault b")).toBeUndefined(); // shown as 0 on the page
    expect(r.others).toEqual([
      { name: "Vault A - Shelf 2", count: 2, statuses: ["extended", "queued_for_auction"] },
      { name: "123", count: 1, statuses: ["pawned"] },
    ]);
    expect([r.listedTotal, r.otherTotal, r.total]).toEqual([5, 3, 8]);
  });

  it("adds up past 1,000 items (no request limit inside the count)", () => {
    const many: StoredItem[] = Array.from({ length: 2500 }, (_, i) => ({ vault_location: i % 2 ? "Vault A" : "Vault B", status: "pawned" }));
    const r = countByLocation(many, ["Vault A", "Vault B"]);
    expect(r.listed.get("vault a")).toBe(1250);
    expect(r.total).toBe(2500);
  });
});

describe("inventoryTabFor", () => {
  it("picks the Inventory tab that shows all the items", () => {
    expect(inventoryTabFor(["pawned", "extended"])).toBe("vault");
    expect(inventoryTabFor(["forfeited"])).toBe("forfeited");
    expect(inventoryTabFor(["queued_for_auction"])).toBe("auction");
    expect(inventoryTabFor(["pawned", "forfeited"])).toBe("all");
  });
});

describe("switch-off text (VL2)", () => {
  it("says how many items are recorded there", () => {
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(1335)).toBe("1,335 items");
    expect(switchOffMessage(335)).toMatch(/^335 items are currently recorded here\. Switching off stops this location from being offered for new loans\./);
    expect(switchOffMessage(1)).toMatch(/^1 item is currently recorded here\./);
    expect(switchOffMessage(0)).toMatch(/^No items are currently recorded here\./);
  });
});
