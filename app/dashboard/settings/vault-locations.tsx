"use client"; // has forms with buttons

import { useState } from "react";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Badge, TD, TR } from "@/components/ui";
import { cleanLocationName, itemsLabel, switchOffMessage } from "@/lib/settings/vault-locations";
import { addVaultLocation, setVaultLocationActive, type SettingsFormState } from "./actions";

// #37: one row of the vault location list
export type VaultRow = { id: string; name: string; is_active: boolean; stored: number }; // stored = items kept there now

// the success text the server worked out (VL2: e.g. "335 items still recorded there"), or a plain fallback
const serverMessage = (fallback: string) => (state: SettingsFormState) => state.message ?? fallback;

// The "Add a location" form. After a save the box is emptied for the next one.
// VL8 (Nov 15): before adding, a popup shows the name exactly as it will be saved (spaces cleaned up) and says it
// can't be changed later. Before: the name was saved on one click, and a typo stayed for ever (no rename, no delete).
export function AddVaultLocationForm() {
  const [name, setName] = useState("");
  const clean = cleanLocationName(name);
  return (
    <ActionForm
      action={addVaultLocation}
      successMessage={serverMessage("Location added. It is now on the New Loan list.")}
      resetOnSuccess
      onSuccess={() => setName("")}
      className="flex max-w-xl flex-wrap items-end gap-3"
    >
      <Field
        name="name"
        label="Name"
        required
        minLength={2}
        maxLength={40}
        placeholder="e.g. Vault C"
        hint="2 to 40 characters. Check the spelling: a name can't be changed or deleted later."
        className="min-w-56 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
      />
      <SubmitButton
        pendingLabel="Adding"
        confirm={{
          title: `Add “${clean}”?`,
          message: "Check the spelling. A location's name can't be changed or deleted later; you can only switch it off. It will be offered for new loans right away.",
          confirmLabel: "Add location",
          tone: "primary",
          details: [["Name as it will be saved", clean]],
        }}
      >
        Add location
      </SubmitButton>
    </ActionForm>
  );
}

// The Switch off / Switch on button with its form (the same on the table and the phone cards)
function SwitchButton({ row }: { row: VaultRow }) {
  return (
    <ActionForm
      action={setVaultLocationActive}
      successMessage={serverMessage(row.is_active ? `${row.name} switched off.` : `${row.name} switched on.`)}
      className="inline-block"
    >
      <input type="hidden" name="id" value={row.id} />
      {/* "on" = the Admin wants it switched on; left out = switch it off */}
      {!row.is_active && <input type="hidden" name="active" value="on" />}
      <SubmitButton
        variant="secondary"
        size="sm"
        pendingLabel="Saving"
        confirm={
          row.is_active
            ? {
                // VL2 (Nov 15): the exact location and how many items are recorded there now. Before: "Items already
                // stored there stay where they are", with no number. The server checks the location again before saving.
                title: `Switch off ${row.name}?`,
                message: switchOffMessage(row.stored),
                confirmLabel: "Switch off",
              }
            : undefined
        }
      >
        {row.is_active ? "Switch off" : "Switch on"}
        <span className="sr-only"> {row.name}</span>
      </SubmitButton>
    </ActionForm>
  );
}

const statusBadge = (on: boolean) => (on ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>);

// One location in the table (tablets and computers)
export function VaultLocationRow({ row }: { row: VaultRow }) {
  return (
    <TR highlight={row.is_active ? undefined : "warning"}>
      <TD>
        <span className="font-medium text-slate-900">{row.name}</span>
      </TD>
      <TD>{statusBadge(row.is_active)}</TD>
      <TD align="right">
        <span className="tabular-nums">{row.stored.toLocaleString("en-PH")}</span>
      </TD>
      <TD align="right">
        <SwitchButton row={row} />
      </TD>
    </TR>
  );
}

// VL5 (Nov 15): one location as a compact card on phones (below 640px): name, On/Off, items, the button.
// Before: the table scrolled sideways inside its box and hid the item count and the Switch off button.
export function VaultLocationCard({ row }: { row: VaultRow }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium text-slate-900">{row.name}</span>
          {statusBadge(row.is_active)}
        </p>
        <p className="mt-0.5 text-xs text-slate-600">{itemsLabel(row.stored)} stored now</p>
      </div>
      <div className="shrink-0">
        <SwitchButton row={row} />
      </div>
    </li>
  );
}

// VL3 (Nov 15): the other location names items are still recorded under (typed before the list existed), read only.
// Each opens Inventory filtered to that exact name. Nothing here renames, merges or moves anything.
export type OtherLocationRow = { name: string; count: number; href: string };

export function OtherLocations({ rows, total }: { rows: OtherLocationRow[]; total: number }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((o) => (
        <li key={o.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 break-words font-medium text-slate-900">{o.name || "(no name recorded)"}</span>
          <Link href={o.href} className="shrink-0 rounded font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            {itemsLabel(o.count)}
            <span className="sr-only"> recorded under {o.name}, open in Inventory</span>
          </Link>
        </li>
      ))}
      <li className="px-4 py-2 text-xs text-slate-600">{`${itemsLabel(total)} in all`}</li>
    </ul>
  );
}
