"use client"; // a popup with a form

import { useRef, useState } from "react";
import Link from "next/link";
import { PopupButton } from "@/components/popup-button";
import { ActionForm, SelectField, SubmitButton, TextareaField } from "@/components/form";
import { moveItem, type ActionState } from "./actions";

// VL1 (Nov 15, migration 0075): "Move" on an Inventory row, for Operators and Admins, on items still in the shop.
// Before: there was no way to change an item's location in the app (it was typed once on the loan).
// Now: pick a location from the list (only switched-on ones, not the one it is in now) and write why. The popup sends
// the location it showed, so if someone else moved the item first the database refuses instead of moving it twice.
// An item in an open Physical audit can't be moved (owner decision): the popup says which audit and links to it.
export type MoveTarget = {
  id: string;
  from: string; // the location exactly as recorded now
  item: string; // e.g. "Chain, 18K, 5.2 g", for the title and the screen reader
  openAudit: string | null; // the id of an open audit that lists this item, if any
};

export function MoveItemButton({ target, locations }: { target: MoveTarget; locations: string[] }) {
  return (
    <PopupButton label="Move" title="Move to another location" ariaLabel={`Move ${target.item} from ${target.from}`}>
      {target.openAudit ? <Blocked target={target} /> : <MoveForm target={target} locations={locations} />}
    </PopupButton>
  );
}

// the item is in an open audit: explain and link to it (nothing to send)
function Blocked({ target }: { target: MoveTarget }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <Where target={target} />
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
        This item is in an open Physical audit ({target.openAudit!.slice(0, 8)}). Submit or discard that audit first, then move the item. Moving it
        during a count would make the count wrong.
      </p>
      <Link
        href={`/dashboard/inventory/audit/${target.openAudit}`}
        className="inline-block rounded font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
      >
        Open the audit
      </Link>
    </div>
  );
}

function Where({ target }: { target: MoveTarget }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-slate-500">Item</dt>
      <dd className="font-medium text-slate-900">{target.item}</dd>
      <dt className="text-slate-500">Recorded in</dt>
      <dd className="break-words font-medium text-slate-900">{target.from || "(no name recorded)"}</dd>
    </dl>
  );
}

function MoveForm({ target, locations }: { target: MoveTarget; locations: string[] }) {
  const box = useRef<HTMLDivElement>(null); // to close the popup after the move
  const [requestId] = useState(() => crypto.randomUUID()); // one per popup: a double click saves one move
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  // every switched-on location except the one it is in now (capitals don't matter, like the database)
  const choices = locations.filter((l) => l.toLowerCase() !== target.from.trim().toLowerCase());

  if (choices.length === 0) {
    return (
      <div className="space-y-3 text-sm text-slate-700">
        <Where target={target} />
        <p>No other location is switched on. An Admin can add or switch on one in Settings → Vault locations.</p>
      </div>
    );
  }

  return (
    <div ref={box}>
      <ActionForm<ActionState>
        action={moveItem}
        successMessage={`Moved to ${to}.`}
        onSuccess={() => box.current?.closest("dialog")?.close()}
        className="space-y-4"
      >
        <Where target={target} />
        <input type="hidden" name="item_id" value={target.id} />
        {/* the location this popup showed: the database refuses if it changed since */}
        <input type="hidden" name="expected_from" value={target.from} />
        <input type="hidden" name="request_id" value={requestId} />
        <SelectField label="Move to" name="to" required value={to} onChange={(e) => setTo(e.target.value)} hint="Only locations that are switched on.">
          <option value="" disabled>
            Choose a location
          </option>
          {choices.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextareaField
          label="Reason"
          name="reason"
          required
          minLength={5}
          maxLength={300}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Found in Vault B during the count; recorded in the wrong place"
          hint="5 to 300 characters. Saved with the move, your name and the time."
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => box.current?.closest("dialog")?.close()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          >
            Cancel
          </button>
          <SubmitButton
            pendingLabel="Moving"
            confirm={{
              title: "Move this item?",
              message: "The item's recorded location changes now. The move is kept in the item's history and the Audit trail.",
              confirmLabel: "Move item",
              tone: "primary",
              details: [
                ["Item", target.item],
                ["From", target.from || "(no name recorded)"],
                ["To", to],
                ["Reason", reason.trim()],
              ],
            }}
          >
            Move item
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
