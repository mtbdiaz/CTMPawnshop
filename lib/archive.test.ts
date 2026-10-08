import { describe, expect, it } from "vitest";
import { ARCHIVABLE_TABLES, ARCHIVE_LABELS } from "./archive";

describe("archive tables", () => {
  it("covers every record type staff can create, each with a label", () => {
    for (const t of ["customers", "appraisal_items", "loans", "loan_payments", "cash_flow_entries", "inventory_items"]) {
      expect(ARCHIVABLE_TABLES).toContain(t);
    }
    for (const t of ARCHIVABLE_TABLES) expect(ARCHIVE_LABELS[t]).toBeTruthy();
  });
});
