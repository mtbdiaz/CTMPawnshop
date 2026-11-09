"use client"; // runs in the browser: ticking items and typing minimum prices

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { formatPeso } from "@/lib/format";
import { createAuctionBatch } from "../actions";

// PB-26 + UC18: pick forfeited items for a batch. Each ticked item can get a minimum price (UC18 step 2,
// "Operator sets minimum sale price"); the database then refuses a sale below it. Empty = no minimum.
export function AuctionForm({ items }: { items: { id: string; label: string; location: string; value: number }[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()); // ticked item ids
  const allSelected = selected.size === items.length;

  return (
    <ActionForm action={createAuctionBatch} className="space-y-4" successMessage="Auction batch created." onSuccess={() => setSelected(new Set())}>
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
            className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
          />
          Select all ({items.length})
        </label>
        <span className="text-sm text-slate-600">{selected.size} selected</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((item) => {
          const on = selected.has(item.id); // ticked = goes in the batch
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="item_id"
                  value={item.id}
                  checked={on}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
                />
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {/* the appraised value, so the Operator has a guide for the minimum price */}
                  <span className="block text-xs text-slate-500">
                    {item.location} · appraised {formatPeso(item.value)}
                  </span>
                </span>
              </label>
              {/* UC18: minimum price, only for ticked items (an unticked box isn't sent) */}
              <input
                type="text"
                inputMode="decimal"
                name={`min_price_${item.id}`}
                disabled={!on}
                placeholder="Min. price (optional)"
                aria-label={`Minimum price for ${item.label}`}
                className="w-44 rounded-md border border-slate-300 px-3 py-1.5 text-sm tabular-nums placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-600">Minimum price: the lowest amount the item may be sold for. A sale below it is refused. Leave empty for no minimum.</p>
      <Field label="Batch notes" name="notes" placeholder="e.g. October auction lot" className="max-w-md" />
      <SubmitButton
        pendingLabel="Creating batch"
        disabled={selected.size === 0}
        confirm={{
          title: "Queue these items for auction?",
          message: `${selected.size} forfeited item(s) will be marked "queued for auction".`,
          confirmLabel: "Create batch",
          tone: "primary",
        }}
      >
        Create auction batch
      </SubmitButton>
    </ActionForm>
  );
}
