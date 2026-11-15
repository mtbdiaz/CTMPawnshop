"use client"; // the Review popup runs in the browser

// Archive Phase 2B (Nov 15): "Review" on every archived record, instead of a bare Restore button.
// The popup shows what the record is, when, by whom and why it was archived, its archive history, and whether it can
// come back. Restore is only offered when the database says so (archive_restore_check, migration 0085), and needs a
// written reason. Types that are kept as history (payments, renewals, reminders, the ledger, auction batches, vault
// audits) never get a Restore button: the popup says why instead.

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { Alert, buttonClasses } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatDateTime } from "@/lib/format";
import { RESTORE_REASON_MIN, restoreReasonError, type ArchivableTable } from "@/lib/archive";
import type { ArchiveRow } from "@/lib/archive-view";
import { checkRestore, getArchiveHistory, restoreRecord, type ArchiveHistoryEvent, type ArchiveState, type RestoreCheck } from "./actions";

// The three server actions the popup calls. The real page always uses these; a test page can pass made-up ones so an
// eligible and an ineligible record can be shown without touching real records.
type ArchiveApi = { checkRestore: typeof checkRestore; getArchiveHistory: typeof getArchiveHistory; restoreRecord: typeof restoreRecord };
export const ArchiveApiContext = createContext<ArchiveApi>({ checkRestore, getArchiveHistory, restoreRecord });

// ---------- the popup (the browser's <dialog>): Esc and the dark area close it, focus goes back to Review ----------
function ReviewDialog({ open, onClose, title, children, returnFocus }: { open: boolean; onClose: () => void; title: string; children: ReactNode; returnFocus: React.RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus(); // Close/Cancel first, never Restore
    }
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
        returnFocus.current?.focus();
      }}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </dialog>
  );
}

const closeNearestDialog = (el: Element | null) => (el?.closest("dialog") as HTMLDialogElement | null)?.close();

function CloseButton({ label = "Cancel" }: { label?: string }) {
  return (
    <button type="button" data-autofocus="" onClick={(e) => closeNearestDialog(e.currentTarget)} className={buttonClasses("secondary")}>
      {label}
    </button>
  );
}

function History({ events }: { events: ArchiveHistoryEvent[] }) {
  return (
    <ol className="space-y-2 border-l-2 border-gold-200 pl-3">
      {events.map((e, i) => (
        <li key={i} className="text-sm">
          <p className="font-medium text-slate-800">
            {e.action === "archived" ? "Archived" : "Restored"} · {formatDateTime(e.at)} · {e.by}
          </p>
          <p className="break-words text-slate-600">{e.reason}</p>
        </li>
      ))}
    </ol>
  );
}

type Eligibility = { state: "checking" } | { state: "done"; check: RestoreCheck } | { state: "failed" };

function RestorePanel({ table, row, eligibility }: { table: ArchivableTable; row: ArchiveRow; eligibility: Eligibility }) {
  const api = useContext(ArchiveApiContext);
  const [reason, setReason] = useState("");
  const tooShort = restoreReasonError(reason) !== null;
  if (eligibility.state === "checking") {
    return (
      <p className="text-sm text-slate-600" role="status">
        Checking whether this record can be restored...
      </p>
    );
  }
  if (eligibility.state === "failed") {
    return (
      <Alert tone="warning" title="Restore isn't available right now">
        The safety check couldn&apos;t run, so restoring isn&apos;t offered. Nothing was changed.
      </Alert>
    );
  }
  const c = eligibility.check;
  if (!c.canRestore) {
    return (
      <Alert tone="warning" title="Can't be restored">
        {c.reason ?? "This record can't be restored."}
      </Alert>
    );
  }
  return (
    <ActionForm<ArchiveState>
      action={api.restoreRecord}
      successMessage={`${row.title} restored.`}
      onSuccess={() => document.querySelector<HTMLDialogElement>("dialog[open]")?.close()}
      className="space-y-3"
    >
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        This record can be restored. It goes back to the normal lists; nothing else about it changes.
      </p>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={row.id} />
      <TextareaField
        label="Reason for restoring"
        name="reason"
        required
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint={`At least ${RESTORE_REASON_MIN} characters. It's kept in the record's history.`}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <CloseButton />
        <SubmitButton pendingLabel="Restoring" disabled={tooShort}>
          Restore record
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ArchiveReview({ table, typeLabel, row, historyOnly }: { table: ArchivableTable; typeLabel: string; row: ArchiveRow; historyOnly: string | null }) {
  const api = useContext(ArchiveApiContext);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ArchiveHistoryEvent[] | null | undefined>(undefined);
  const [eligibility, setEligibility] = useState<Eligibility>({ state: "checking" });
  const button = useRef<HTMLButtonElement>(null);
  const canRestore = eligibility.state === "done" && eligibility.check.canRestore;

  // when the check says yes, the Close button the popup opened on is replaced by the restore form, so focus moves to
  // the reason box (the next thing to do) instead of getting lost
  useEffect(() => {
    if (open && canRestore) document.querySelector<HTMLTextAreaElement>("dialog[open] textarea[name='reason']")?.focus();
  }, [open, canRestore]);

  function show() {
    setOpen(true);
    setHistory(undefined);
    api.getArchiveHistory(table, row.id).then(setHistory, () => setHistory(null));
    if (!historyOnly) {
      setEligibility({ state: "checking" });
      api.checkRestore(table, row.id).then(
        (check) => setEligibility(check.failed ? { state: "failed" } : { state: "done", check }),
        () => setEligibility({ state: "failed" }),
      );
    }
  }

  return (
    <>
      <button ref={button} type="button" onClick={show} aria-label={`Review ${row.title}`} className={buttonClasses("secondary", "sm")}>
        Review
      </button>
      <ReviewDialog open={open} onClose={() => setOpen(false)} title="Review archived record" returnFocus={button}>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{typeLabel}</p>
          <p className="break-words text-base font-semibold text-slate-900">{row.title}</p>
          {row.detail && <p className="break-words text-sm text-slate-600">{row.detail}</p>}
          {row.href && (
            <a href={row.href} className="mt-1 inline-block text-sm font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900">
              Open the record
            </a>
          )}
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm">
          <dt className="text-slate-500">Archived</dt>
          <dd className="text-slate-900">{formatDateTime(row.archivedAt)}</dd>
          <dt className="text-slate-500">By</dt>
          <dd className="text-slate-900">{row.archivedBy}</dd>
          <dt className="text-slate-500">Reason</dt>
          <dd className="whitespace-pre-line break-words text-slate-900">{row.reason || "No reason was written."}</dd>
        </dl>
        <section aria-label="Archive history">
          <h3 className="mb-1.5 text-sm font-semibold text-slate-800">History</h3>
          {history === undefined ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : history === null ? (
            <p className="text-sm text-slate-500">The archive history list isn&apos;t available yet. The details above come from the record itself.</p>
          ) : history.length > 0 ? (
            <History events={history} />
          ) : (
            <p className="text-sm text-slate-500">No earlier archive or restore on record. The details above are the full history.</p>
          )}
        </section>
        <section aria-label="Restore">
          {historyOnly ? (
            <>
              <Alert tone="info" title="Kept as history">
                {historyOnly}
              </Alert>
              <div className="mt-3 flex justify-end">
                <CloseButton label="Close" />
              </div>
            </>
          ) : eligibility.state === "done" && eligibility.check.canRestore ? (
            <RestorePanel table={table} row={row} eligibility={eligibility} />
          ) : (
            <>
              <RestorePanel table={table} row={row} eligibility={eligibility} />
              <div className="mt-3 flex justify-end">
                <CloseButton label="Close" />
              </div>
            </>
          )}
        </section>
      </ReviewDialog>
    </>
  );
}
