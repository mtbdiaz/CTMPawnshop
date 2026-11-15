import { describe, expect, it } from "vitest";
import { ARCHIVABLE_TABLES, ARCHIVE_LABELS } from "./archive";
import { archiveCountLine, archiveFilters, describeArchived, filterArchiveRows, historyOnlyReason, isFiltered, pageOf, SYSTEM_ACTOR, type ArchiveRow } from "./archive-view";

const row = (id: string, title: string, at: string, by: string | null, reason = ""): ArchiveRow => ({
  id,
  title,
  detail: "",
  reason,
  archivedAt: at,
  archivedById: by,
  archivedBy: by ? "Rowena Abella" : "System (data cleanup)",
  href: null,
});
const rows = [
  row("a", "Customer #379 · Arch Coles", "2026-11-09T14:06:00Z", null, "Duplicate of the Sep 24 Arch Coles record"),
  row("b", "Customer #187 · Sheila T. Cabahug", "2026-08-13T04:10:00Z", "11111111-1111-4111-8111-111111111111", "Duplicate registration"),
  row("c", "Customer #325 · Ena", "2026-11-06T11:39:00Z", null, "Test record, archived during backend review cleanup"),
];
const now = new Date("2026-11-15T12:00:00Z");

describe("archiveFilters", () => {
  it("reads known values only", () => {
    expect(archiveFilters({ q: "  arch ", when: "30d", by: "system", sort: "oldest" })).toEqual({ q: "arch", when: "30d", by: "system", sort: "oldest" });
    expect(archiveFilters({ when: "forever", by: "x' or 1=1", sort: "sideways" })).toEqual({ q: "", when: "any", by: "", sort: "newest" });
    expect(isFiltered(archiveFilters({}))).toBe(false);
    expect(isFiltered(archiveFilters({ sort: "oldest" }))).toBe(true);
  });
});

describe("filterArchiveRows", () => {
  it("searches name, reason and who, in any order and capitals", () => {
    expect(filterArchiveRows(rows, archiveFilters({ q: "COLES arch" }), now).map((r) => r.id)).toEqual(["a"]);
    expect(filterArchiveRows(rows, archiveFilters({ q: "backend review" }), now).map((r) => r.id)).toEqual(["c"]);
    expect(filterArchiveRows(rows, archiveFilters({ q: "rowena" }), now).map((r) => r.id)).toEqual(["b"]);
  });
  it("filters by date and by who (a person, or the data cleanup)", () => {
    expect(filterArchiveRows(rows, archiveFilters({ when: "30d" }), now).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterArchiveRows(rows, archiveFilters({ by: SYSTEM_ACTOR }), now).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterArchiveRows(rows, archiveFilters({ by: "11111111-1111-4111-8111-111111111111" }), now).map((r) => r.id)).toEqual(["b"]);
  });
  it("sorts newest or oldest first", () => {
    expect(filterArchiveRows(rows, archiveFilters({}), now).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(filterArchiveRows(rows, archiveFilters({ sort: "oldest" }), now).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("pageOf", () => {
  it("cuts 10 per page and keeps the page in range", () => {
    const many = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(many, 3)).toMatchObject({ page: 3, pages: 3, rows: [20, 21, 22] });
    expect(pageOf(many, 99).page).toBe(3);
    expect(pageOf([], 1)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });
});

describe("describeArchived", () => {
  it("gives readable names, never IDs or raw timestamps", () => {
    const samples: Record<string, Record<string, unknown>> = {
      customers: { id: "c1", customer_no: 379, full_name: "Arch Coles", contact_number: "09295378191" },
      appraisal_items: { id: "a1", appraisal_no: 988, category: "pendant_with_chain", karat: 24, weight_grams: "5.569", customers: null },
      loans: { id: "l1", ticket_number: "PT-20260721111733-22D4", status: "redeemed", principal_amount: 6000, customers: { full_name: "Juan" } },
      loan_payments: { id: "p1", receipt_number: "OR-1", amount: 500, loans: { ticket_number: "PT-1" } },
      loan_extensions: { id: "x1", new_maturity_date: "2026-12-01", extension_type: "renewal", loans: { ticket_number: "PT-1" } },
      inventory_items: { id: "i1", status: "redeemed", appraisal_items: { appraisal_no: 5, category: "ring", karat: 18, weight_grams: 2 }, loans: [{ ticket_number: "PT-2" }] },
      cash_flow_entries: { id: "f1", entry_type: "expense", amount: 100, description: "Office supplies" },
      auction_batches: { id: "b1", batch_no: 2, auction_date: null, auction_batch_items: [{ count: 1 }] },
      physical_inventory_audits: { id: "u1", scope_vault: "Vault A - Shelf 5", status: "discarded", started_at: "2026-11-12T08:00:00Z" },
      suspicious_activity_flags: { id: "s1", reason: "Many pawns", status: "dismissed", customers: { full_name: "Ana" } },
      reminder_log: { id: "r1", contact_method: "sms", outcome: "message_sent", sent_at: "2026-11-01T02:00:00Z", loans: { ticket_number: "PT-3" } },
    };
    for (const t of ARCHIVABLE_TABLES) {
      const d = describeArchived(t, samples[t]);
      expect(d.title.length).toBeGreaterThan(3);
      expect(`${d.title} ${d.detail}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|T\d\d:\d\d|undefined|null/);
    }
    expect(describeArchived("auction_batches", samples.auction_batches).title).toBe("Auction batch #2");
    expect(describeArchived("auction_batches", samples.auction_batches).detail).toBe("1 item");
    expect(describeArchived("appraisal_items", samples.appraisal_items).detail).toBe("No customer on it");
    expect(describeArchived("customers", samples.customers).href).toBe("/dashboard/customers/c1");
  });
});

describe("historyOnlyReason", () => {
  it("explains every type that can never be restored, and nothing else", () => {
    for (const t of ["loan_payments", "loan_extensions", "reminder_log", "cash_flow_entries", "auction_batches", "physical_inventory_audits"] as const) {
      expect(historyOnlyReason(t)).toBeTruthy();
    }
    for (const t of ["customers", "appraisal_items", "loans", "inventory_items", "suspicious_activity_flags"] as const) expect(historyOnlyReason(t)).toBeNull();
  });
});

describe("archiveCountLine", () => {
  const none = archiveFilters({});
  it("counts in plain words, one or many", () => {
    expect(archiveCountLine("Customers", 8, 8, none)).toBe("8 archived customers.");
    expect(archiveCountLine("Auction batches", 1, 1, none)).toBe("1 archived auction batch.");
    expect(archiveCountLine("Cash entries", 1, 1, none)).toBe("1 archived cash entry.");
    expect(archiveCountLine("Vault audits", 500, 500, none)).toBe("500 archived vault audits (the newest 500).");
    for (const t of ARCHIVABLE_TABLES) expect(archiveCountLine(ARCHIVE_LABELS[t], 1, 1, none)).not.toMatch(/s\.$|ie\.$|che\.$/);
  });
  it("says nothing when the type is empty (the empty box says it)", () => {
    expect(archiveCountLine("Payments", 0, 0, none)).toBe("");
    expect(archiveCountLine("Payments", 0, 0, archiveFilters({ q: "abc" }))).toBe("");
  });
  it("only talks about matches when a real filter is on, not for a sort", () => {
    expect(archiveCountLine("Customers", 8, 8, archiveFilters({ sort: "oldest" }))).toBe("8 archived customers.");
    expect(archiveCountLine("Customers", 8, 6, archiveFilters({ by: "system" }))).toBe("6 of 8 archived customers match.");
    expect(archiveCountLine("Customers", 8, 1, archiveFilters({ q: "coles" }))).toBe("1 of 8 archived customers matches.");
    expect(archiveCountLine("Customers", 8, 0, archiveFilters({ q: "zzz" }))).toBe("No archived records match these filters.");
  });
});
