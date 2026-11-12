"use client"; // runs in the browser: the Details popup and the Copy button

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PopupButton } from "@/components/popup-button";
import { ArchiveForm } from "@/components/archive-controls"; // S4: archive a manual entry made by mistake (Admin)
import { Badge, buttonClasses } from "@/components/ui";
import { formatDateTime, formatPeso } from "@/lib/format";
import { MOVEMENT_LABEL, entryTypeLabel, movementOf, type LedgerRow } from "@/lib/finance/ledger";
import { AdminEditCashEntryForm } from "./cash-entry-form";

// one label + value
function Info({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{children}</dd>
    </div>
  );
}

// copies a long id (the browser's clipboard); the text is also selectable by hand
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* the browser refused; the text can still be selected and copied by hand */
        }
      }}
      aria-label={`Copy ${label}`}
      className="ml-2 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
    >
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

// CL1 (Nov 12): "Details" on a ledger row. It shows only what the database really has for the entry:
// its reference, when, the type, the movement, who recorded it, where it came from, the loan and customer it
// belongs to, and any Admin correction made to it. It changes nothing by itself.
// For an Admin, a MANUAL entry also has the two existing tools here (Correct, Archive), each with a written reason.
// locked (LK1, migration 0058): Correct and Archive are switched off in the database for every role, so the page
// shows an explanation instead of two buttons that would be refused.
export function EntryDetails({ row, isAdmin, locked }: { row: LedgerRow; isAdmin: boolean; locked: boolean }) {
  const move = movementOf(row);
  return (
    <PopupButton
      label="Details"
      title="Ledger entry"
      // CL2: every row has a "Details" button, so a screen reader is told which entry this one opens
      ariaLabel={`Details of ${entryTypeLabel(row.entry_type)}, ${formatDateTime(row.created_at)}${row.ticket_number ? `, ticket ${row.ticket_number}` : row.description ? `, ${row.description.slice(0, 60)}` : ""}`}
    >
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
          {entryTypeLabel(row.entry_type)}
          <Badge tone={row.manual ? "info" : "neutral"}>{row.manual ? "Manual entry" : "Recorded by the system"}</Badge>
          {row.is_memo && <Badge tone="neutral">Non-cash</Badge>}
          {row.no_sale_record && <Badge tone="warning">No sale record</Badge>}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Info label="Date and time">{formatDateTime(row.created_at)}</Info>
          <Info label="Recorded by">{row.created_by_name ?? "Not recorded"}</Info>
          <Info label="Movement">
            {MOVEMENT_LABEL[move]}
            {move !== "noncash" && (
              <span className="ml-1 font-medium tabular-nums">
                {move === "in" ? "+" : "−"}
                {formatPeso(Number(row.amount))}
              </span>
            )}
          </Info>
          <Info label="Ledger balance after this entry">
            <span className="tabular-nums">{formatPeso(Number(row.balance))}</span>
          </Info>
          {move === "noncash" && (
            <Info label="Amount noted (no cash moved)" wide>
              <span className="tabular-nums">{formatPeso(Number(row.amount))}</span>. It is listed so the loan&apos;s history is complete; it is not in any cash total.
            </Info>
          )}
          <Info label="Source">{row.manual ? "Typed in by staff (Record cash entry)" : row.ticket_number ? "The loan below" : "The system"}</Info>
          <Info label="Status">Active (in the ledger)</Info>
          {row.ticket_number && (
            <Info label="Pawn ticket">
              <span className="font-mono text-xs">{row.ticket_number}</span>
              <CopyButton text={row.ticket_number} label="pawn ticket number" />
            </Info>
          )}
          {row.customer_name && <Info label="Customer">{row.customer_name}</Info>}
          {row.receipt_number && (
            <Info label="Receipt number" wide>
              <span className="font-mono text-xs">{row.receipt_number}</span>
              <CopyButton text={row.receipt_number} label="receipt number" />
            </Info>
          )}
          <Info label="Description" wide>
            {row.description || "None"}
          </Info>
          <Info label="Entry reference" wide>
            <span className="font-mono text-xs">{row.id}</span>
            <CopyButton text={row.id} label="entry reference" />
          </Info>
        </dl>

        {row.no_sale_record && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
            This is auction-sale money, but the item of this ticket has no sale record and is still in the vault. It is counted in the ledger balance. An Admin has to
            decide what it is; nothing was changed.
          </p>
        )}

        {/* corrections made to this entry (from the audit log) */}
        <div className="border-t border-slate-200 pt-3">
          <p className="font-medium text-slate-900">Corrections</p>
          {row.edits.length ? (
            <ul className="mt-1 space-y-1 text-xs text-slate-700">
              {row.edits.map((e, i) => (
                <li key={i} className="break-words">
                  {formatDateTime(e.at)} · {e.by ?? "Admin"} · amount {e.before != null ? formatPeso(Number(e.before)) : "?"} → {e.after != null ? formatPeso(Number(e.after)) : "?"} ·{" "}
                  <span className="italic">&ldquo;{e.reason}&rdquo;</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-slate-600">
              None.{" "}
              {!row.manual
                ? "An entry made by a loan or payment is corrected from that loan, which adds an Adjustment entry; the original stays."
                : locked
                  ? "A saved entry can't be corrected or archived in the app right now (see below)."
                  : "Only an Admin can correct or archive a manual entry, with a written reason."}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {row.related_loan_id && (
            <Link href={`/dashboard/loans/${row.related_loan_id}`} className={buttonClasses("secondary", "sm")}>
              Open loan
            </Link>
          )}
        </div>

        {/* the existing Admin tools for a manual entry, folded away so they are never pressed by accident */}
        {/* LK1: while the lock is on, everyone who opens a manual entry is told what to do about a mistake */}
        {locked && row.manual && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-slate-900">Correcting and archiving ledger entries is switched off for now</span>, for every role, until a proper
            reversal workflow is approved. If this entry is wrong, it can&apos;t be fixed in the app yet: tell the Admin and write down what is wrong (the entry reference
            above helps). Don&apos;t record another entry to balance it.
          </p>
        )}
        {isAdmin && row.manual && !locked && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <details>
              <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">Correct this entry (Admin)</summary>
              <div className="mt-2">
                {/* FC1: say plainly what a correction does to the books */}
                <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  This changes the entry&apos;s amount, so the ledger balance and every balance after this entry change too. The old amount, the new amount, your reason and
                  your name are kept in the audit log and shown under Corrections.
                </p>
                <AdminEditCashEntryForm id={row.id} amount={Number(row.amount)} description={row.description ?? ""} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">Archive this entry (Admin)</summary>
              <div className="mt-2">
                <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  An archived entry is taken out of the list and out of every total and balance. It is kept, with your reason and name, and an Admin can restore it from
                  Archive. The page shows how many entries are archived.
                </p>
                <ArchiveForm table="cash_flow_entries" id={row.id} label="Cash entry" />
              </div>
            </details>
          </div>
        )}
      </div>
    </PopupButton>
  );
}
