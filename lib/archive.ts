export const ARCHIVABLE_TABLES = [
  "customers",
  "appraisal_items",
  "loans",
  "loan_payments",
  "loan_extensions",
  "inventory_items",
  "cash_flow_entries",
  "auction_batches",
  "physical_inventory_audits",
  "suspicious_activity_flags",
  "reminder_log",
] as const;

export type ArchivableTable = (typeof ARCHIVABLE_TABLES)[number];

export const ARCHIVE_LABELS: Record<ArchivableTable, string> = {
  customers: "Customers",
  appraisal_items: "Appraisals",
  loans: "Loans",
  loan_payments: "Payments",
  loan_extensions: "Renewals",
  inventory_items: "Inventory items",
  cash_flow_entries: "Cash entries",
  auction_batches: "Auction batches",
  physical_inventory_audits: "Vault audits",
  suspicious_activity_flags: "Suspicious-activity flags",
  reminder_log: "Reminders",
};

// 0085 (Archive Phase 2A): what the database allows for each type, so pages only offer what will work.
// The database (archive_record, restore_record, ctm_restore_blocker) still checks every single record.
//   archive: "allowed" = from that record's page, with a reason (and the type's own rule);
//            "elsewhere" = set aside by another screen (vault audits: Discard draft); "never" = refused.
//   restore: "checked" = possible after the record passes its type's checks (ask archive_restore_check);
//            "never" = kept in history read-only.
export type ArchivePolicy = { archive: "allowed" | "elsewhere" | "never"; restore: "checked" | "never" };
export const ARCHIVE_POLICY: Record<ArchivableTable, ArchivePolicy> = {
  customers: { archive: "allowed", restore: "checked" }, // archive: no open loans; restore: no duplicate (ID, same person, archived as duplicate)
  appraisal_items: { archive: "allowed", restore: "checked" }, // archive: still in the pool; restore: customer, no loan, no open counterfeit flag, no twin
  loans: { archive: "allowed", restore: "checked" }, // archive: closed only; restore: never VOID, never without its item
  loan_payments: { archive: "never", restore: "never" }, // permanent history (Wush, decision 2)
  loan_extensions: { archive: "never", restore: "never" },
  reminder_log: { archive: "never", restore: "never" },
  cash_flow_entries: { archive: "never", restore: "never" }, // ledger lock (0058) until a reversal workflow is approved
  inventory_items: { archive: "never", restore: "checked" }, // restore: only redeemed/sold items whose loan isn't archived
  auction_batches: { archive: "never", restore: "never" }, // decision 3
  physical_inventory_audits: { archive: "elsewhere", restore: "never" }, // Discard draft; decision 3
  suspicious_activity_flags: { archive: "never", restore: "checked" }, // restore: decided flags only
};

export const RESTORE_REASON_MIN = 10;

/** The same rule as the database (ctm_flag_reason_ok): at least 10 characters and at least one letter. */
export function restoreReasonError(reason: string): string | null {
  const clean = reason.trim().replace(/\s+/g, " ");
  if (clean.length < RESTORE_REASON_MIN || !/\p{L}/u.test(clean)) return `Write the reason for restoring (at least ${RESTORE_REASON_MIN} characters).`;
  return null;
}

/** Plain-language errors only. The 0085 functions raise readable messages (codes P0001, 42501, 23514); anything else
 *  (an unexpected database error) is never shown as-is. */
export function friendlyArchiveError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong, so nothing was changed. Reload the page and try again.";
  if (error.code === "23505") return "Another active record already uses the same details (for example the same ID), so nothing was changed.";
  if ((error.code === "P0001" || error.code === "42501" || error.code === "23514") && error.message) return error.message;
  return "Something went wrong, so nothing was changed. Reload the page and try again.";
}
