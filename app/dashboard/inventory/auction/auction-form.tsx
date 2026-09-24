"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createAuctionBatch } from "../actions";

export function AuctionForm({ items }: { items: { id: string; label: string; location: string }[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
        {items.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-3 py-2.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                name="item_id"
                value={item.id}
                checked={selected.has(item.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  })
                }
                className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
              />
              <span className="flex-1">{item.label}</span>
              <span className="text-xs text-slate-500">{item.location}</span>
            </label>
          </li>
        ))}
      </ul>
      <Field label="Batch notes" name="notes" placeholder="e.g. October auction lot" className="max-w-md" />
      <SubmitButton
        pendingLabel="Creating batch…"
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
