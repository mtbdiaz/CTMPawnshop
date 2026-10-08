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
