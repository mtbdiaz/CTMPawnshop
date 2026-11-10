"use client"; // has forms with buttons

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Badge, TD, TR } from "@/components/ui";
import { addVaultLocation, setVaultLocationActive } from "./actions";

// #37: one row of the vault location list
export type VaultRow = { id: string; name: string; is_active: boolean; stored: number }; // stored = items kept there now

// The "Add a location" form. After a save the box is emptied for the next one.
export function AddVaultLocationForm() {
  return (
    <ActionForm action={addVaultLocation} successMessage="Location added. It is now on the New Loan list." resetOnSuccess className="flex max-w-xl flex-wrap items-end gap-3">
      <Field name="name" label="Name" required minLength={2} maxLength={40} placeholder="e.g. Vault C" hint="2 to 40 characters. A name can't be changed later." className="min-w-56 flex-1" />
      <SubmitButton pendingLabel="Adding">Add location</SubmitButton>
    </ActionForm>
  );
}

// One location with its Switch off / Switch on button
export function VaultLocationRow({ row }: { row: VaultRow }) {
  return (
    <TR highlight={row.is_active ? undefined : "warning"}>
      <TD>
        <span className="font-medium text-slate-900">{row.name}</span>
      </TD>
      <TD>{row.is_active ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}</TD>
      <TD align="right">
        <span className="tabular-nums">{row.stored}</span>
      </TD>
      <TD align="right">
        <ActionForm action={setVaultLocationActive} successMessage={row.is_active ? `${row.name} switched off.` : `${row.name} switched on.`} className="inline-block">
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
                    title: `Switch off ${row.name}?`,
                    message: "It will no longer be offered for new loans. Items already stored there stay where they are, and you can switch it on again later.",
                    confirmLabel: "Switch off",
                  }
                : undefined
            }
          >
            {row.is_active ? "Switch off" : "Switch on"}
          </SubmitButton>
        </ActionForm>
      </TD>
    </TR>
  );
}
