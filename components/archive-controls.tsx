"use client";

import { ActionForm, Field, SubmitButton } from "./form";
import { archiveRecord, restoreRecord } from "@/app/dashboard/archive/actions";
import type { ArchivableTable } from "@/lib/archive";

/** Item 1: "Archive" (never delete). A reason is required; Admins can restore. */
export function ArchiveForm({ table, id, label }: { table: ArchivableTable; id: string; label: string }) {
  return (
    <ActionForm action={archiveRecord} successMessage={`${label} archived.`} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <Field label="Reason for archiving" name="reason" required placeholder="e.g. Entered twice by mistake" className="min-w-56 flex-1" />
      <SubmitButton
        variant="secondary"
        pendingLabel="Archiving"
        confirm={{
          title: `Archive this ${label.toLowerCase()}?`,
          message: "It disappears from lists and counts but is kept. An Admin can restore it from Archive.",
          confirmLabel: "Archive",
        }}
      >
        Archive
      </SubmitButton>
    </ActionForm>
  );
}

export function RestoreButton({ table, id }: { table: ArchivableTable; id: string }) {
  return (
    <ActionForm action={restoreRecord} successMessage="Record restored.">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        variant="secondary"
        size="sm"
        pendingLabel="Restoring"
        confirm={{ title: "Restore this record?", message: "It returns to the normal lists and counts.", confirmLabel: "Restore", tone: "primary" }}
      >
        Restore
      </SubmitButton>
    </ActionForm>
  );
}
