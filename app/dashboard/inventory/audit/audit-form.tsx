"use client";

import { useEffect, useState } from "react";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { Badge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { submitAudit } from "../actions";

// missingSince: PA3, the date of the audit this item was missing in (and not marked found since), or null
type Item = { id: string; status: string; vault_location: string; label: string; missingSince: string | null };

// PA1: the status in the words the Inventory page uses (the database says "extended" for a renewed loan)
const STATUS_WORDS: Record<string, string> = {
  pawned: "Pawned",
  extended: "Renewed",
  forfeited: "Forfeited, still in vault",
  queued_for_auction: "Queued for auction, still in vault",
};

export function AuditForm({ items }: { items: Item[] }) {
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false); // PA5: something was unticked or typed and not saved yet

  // PA5: the browser asks "Leave site?" on refresh or close while the audit has unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
      // PA6: fixed wording (was "discrepancy(ies)" and a small "all")
      successMessage={() => (missing.size ? `Audit saved. ${missing.size} ${missing.size === 1 ? "discrepancy" : "discrepancies"} recorded.` : "Audit saved. All items accounted for.")}
      onSuccess={() => setDirty(false)} // PA5: saved, so leaving is fine again
    >
      {/* PA5: any tick or typing in the form counts as a change */}
      <div onChange={() => setDirty(true)} onInput={() => setDirty(true)} className="space-y-4">
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
                  <TD>
                    {item.label}
                    {/* PA3: it was missing last time and nobody marked it found, so look for it first */}
                    {item.missingSince && (
                      <span className="ml-2 inline-block align-middle">
                        <Badge tone="warning">Missing in the audit of {item.missingSince}</Badge>
                      </span>
                    )}
                  </TD>
                  <TD>{STATUS_WORDS[item.status] ?? item.status}</TD>
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
            <SubmitButton pendingLabel="Saving audit">Submit audit</SubmitButton>
            <span className="text-sm text-slate-600">
              {items.length - missing.size} of {items.length} found
              {missing.size > 0 && <span className="ml-1 font-semibold text-red-700">· {missing.size} missing</span>}
            </span>
            {dirty && <span className="text-sm text-amber-800">You have unsaved changes.</span>}
          </div>
        </div>
      </div>
    </ActionForm>
  );
}
