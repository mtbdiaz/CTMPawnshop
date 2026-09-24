"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { humanize } from "@/lib/format";
import { submitAudit } from "../actions";

type Item = { id: string; status: string; vault_location: string; label: string };

export function AuditForm({ items }: { items: Item[] }) {
  const [missing, setMissing] = useState<Set<string>>(new Set());

  function toggle(id: string, found: boolean) {
    setMissing((prev) => {
      const next = new Set(prev);
      if (found) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ActionForm
      action={submitAudit}
      className="space-y-4"
      successMessage={() => (missing.size ? `Audit saved — ${missing.size} discrepancy(ies) recorded.` : "Audit saved — all items accounted for.")}
    >
      <Table>
        <THead>
          <TH>Found?</TH>
          <TH>Vault location</TH>
          <TH>Item</TH>
          <TH>System status</TH>
          <TH>Notes</TH>
        </THead>
        <TBody>
          {items.map((item) => {
            const isMissing = missing.has(item.id);
            return (
              <TR key={item.id} highlight={isMissing ? "danger" : undefined}>
                <TD>
                  <input type="hidden" name="item_id" value={item.id} />
                  <input type="hidden" name="expected_status" value={item.status} />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`found_${item.id}`}
                      defaultChecked
                      onChange={(e) => toggle(item.id, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
                    />
                    <span className={isMissing ? "font-semibold text-red-700" : "text-slate-600"}>{isMissing ? "Missing" : "Found"}</span>
                  </label>
                </TD>
                <TD className="font-medium">{item.vault_location}</TD>
                <TD>{item.label}</TD>
                <TD>{humanize(item.status)}</TD>
                <TD>
                  <label className="sr-only" htmlFor={`notes_${item.id}`}>
                    Notes for {item.label}
                  </label>
                  <input
                    id={`notes_${item.id}`}
                    name={`notes_${item.id}`}
                    placeholder={isMissing ? "Describe the discrepancy" : "Optional"}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <div className="px-4 pb-4">
        <TextareaField label="Overall audit notes" name="notes" rows={2} className="max-w-xl" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving audit…">Submit audit</SubmitButton>
          <span className="text-sm text-slate-600">
            {items.length - missing.size} of {items.length} found
            {missing.size > 0 && <span className="ml-1 font-semibold text-red-700">· {missing.size} missing</span>}
          </span>
        </div>
      </div>
    </ActionForm>
  );
}
