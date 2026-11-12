"use client"; // runs in the browser: the popup, the decision buttons and where the keyboard focus goes after saving

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { PopupButton } from "@/components/popup-button"; // the same popup as the other pages (closes with Esc, focus comes back)
import { Alert, Badge, buttonClasses } from "@/components/ui";
import { formatDateTime, formatPeso, humanize } from "@/lib/format";
import { customerNo } from "@/lib/ref-numbers";
import {
  FLAG_STATUS,
  RULE_MIN_LOANS,
  RULE_WINDOW_HOURS,
  actionsFor,
  cleanNote,
  customerLabel,
  eventLabel,
  flagSource,
  reasonProblem,
  ruleEvidence,
  type FlagRow,
} from "@/lib/compliance/flags";
import { resolveSuspiciousFlag, type ActionState } from "./actions";

// SA7 (Nov 12, migration 0062): the popup is split into numbered parts, so a reviewer reads them in order:
//   1. The flag (what was recorded and how it was raised)
//   2. Supporting records (facts from the database, kept apart from the flag's own claim)
//   3. History (every status and note from the audit log, with who and when, so an earlier note is never lost)
//   4. Your decision (Review flag only): a reason is required to Dismiss or Blacklist (SAD UC25)

// one label + value
function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{children}</dd>
    </div>
  );
}

// a numbered part of the popup, with a small heading (h3: the popup's title is the h2)
function Section({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {n}. {title}
      </h3>
      {note && <p className="text-xs text-slate-600">{note}</p>}
      {children}
    </section>
  );
}

// 1. what was recorded on the flag, and where it stands now
function TheFlag({ flag }: { flag: FlagRow }) {
  const status = FLAG_STATUS[flag.status];
  return (
    <Section n={1} title="The flag">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Info label="Customer">
          {flag.customer_name ?? "Unknown"}
          {flag.customer_no ? <span className="block font-mono text-xs text-slate-600">{customerNo(flag.customer_no)}</span> : null}
        </Info>
        <Info label="Status">
          <Badge tone={status.tone}>{status.label}</Badge>
          {/* who is looking into it, when that is stored (Mark investigating saves who and when) */}
          {flag.status === "investigating" && flag.resolved_at && (
            <span className="mt-0.5 block text-xs text-slate-600">
              since {formatDateTime(flag.resolved_at)}
              {flag.resolved_by_name ? ` by ${flag.resolved_by_name}` : ""}
            </span>
          )}
        </Info>
        <Info label="Flagged on">{formatDateTime(flag.created_at)}</Info>
        <Info label="How it was raised">{flagSource(flag)}</Info>
        <div className="sm:col-span-2">
          <Info label="Reason (as recorded)">{flag.reason}</Info>
        </div>
      </dl>
    </Section>
  );
}

// 2. facts from the records. Kept apart from the flag's reason above: the reason is a claim, these are records.
function Records({ flag }: { flag: FlagRow }) {
  const ev = ruleEvidence(flag);
  const loans = flag.customer_loans;
  const lost = flag.lost_ticket_used || flag.lost_ticket_payment;
  return (
    <Section n={2} title="Supporting records" note="Facts from the database. A flag is a reason to check, not proof that the customer did anything wrong.">
      <ul className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        {/* the loan the flag was saved with */}
        {flag.loan_id ? (
          <li>
            <span className="text-slate-600">Linked loan:</span> <span className="font-mono text-xs">{flag.ticket_number}</span>
            {flag.loan_principal != null && <> · {formatPeso(Number(flag.loan_principal))}</>}
            {flag.loan_created_at && <> · made {formatDateTime(flag.loan_created_at)}</>}
            {flag.loan_status && <> · now {humanize(flag.loan_status).toLowerCase()}</>}
          </li>
        ) : (
          <li>No loan is linked to this flag.</li>
        )}
        {/* a lost-ticket redemption: what the records hold about it (they don't say which ID was shown) */}
        {lost && (
          <li>
            <span className="text-slate-600">Lost-ticket redemption:</span>{" "}
            {flag.loan_redeemed_at ? `redeemed ${formatDateTime(flag.loan_redeemed_at)}` : "the loan is marked as redeemed with a lost ticket"}
            {flag.lost_ticket_payment && (
              <>
                {" "}
                · {formatPeso(Number(flag.lost_ticket_payment.amount))} accepted with the lost-ticket check
                {flag.lost_ticket_payment.receipt ? `, receipt ${flag.lost_ticket_payment.receipt}` : ""}
                {flag.lost_ticket_payment.by ? `, by ${flag.lost_ticket_payment.by}` : ""}
              </>
            )}
            <span className="block text-xs text-slate-600">PawnTrack records that the lost-ticket check was used. It does not store which ID was shown.</span>
          </li>
        )}
        {/* the automatic rule only: the loans in the 24 hours up to the flag, counted now from the loan records */}
        {ev !== "none" && (
          <li>
            <span className="text-slate-600">Loans opened in the {RULE_WINDOW_HOURS} hours up to the flag:</span> <span className="font-semibold">{flag.loans_24h}</span>
            {Number(flag.loans_24h_sum) > 0 && <> ({formatPeso(Number(flag.loans_24h_sum))} in total)</>}
          </li>
        )}
        {/* the customer's history, so one flag is seen next to the rest */}
        {loans && (
          <li>
            <span className="text-slate-600">Customer&apos;s loans:</span> {loans.total} in total · {loans.active} active · {loans.redeemed} redeemed · {loans.defaulted}{" "}
            defaulted
          </li>
        )}
        <li>
          <span className="text-slate-600">Other flags on this customer:</span>{" "}
          {flag.other_flags > 0 ? (
            <>
              {flag.other_flags}
              {flag.other_flags_blacklisted > 0 ? ` (${flag.other_flags_blacklisted} ended in Blacklisted)` : ""}
            </>
          ) : (
            "none"
          )}
        </li>
        <li>
          <span className="text-slate-600">AML check:</span> {flag.customer_aml_status ? humanize(flag.customer_aml_status) : "Not recorded"}
          <span className="text-slate-600"> · ID on file:</span> {flag.customer_id_type ? humanize(flag.customer_id_type) : "none recorded"}
        </li>
        {flag.customer_blacklisted && (
          <li className="text-red-800">
            The customer is already blacklisted{flag.blacklist_reason ? `: "${flag.blacklist_reason}"` : "."}
          </li>
        )}
      </ul>
      {/* the 7 "many loans" flags in the data don't match the rule: say so instead of hiding it */}
      {ev === "below" && (
        <p className="text-xs text-amber-900">
          The automatic rule flags {RULE_MIN_LOANS} or more loans in {RULE_WINDOW_HOURS} hours, but the loan records show {flag.loans_24h}. This flag was probably not
          added by the rule (for example, it came with the sample data). The reason above is kept as it was recorded.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {flag.customer_id && (
          <Link href={`/dashboard/customers/${flag.customer_id}`} className={buttonClasses("secondary", "sm")}>
            View customer
          </Link>
        )}
        {/* the loan's own page (read only). Not the Loans list: that page can run the default check */}
        {flag.loan_id && (
          <Link href={`/dashboard/loans/${flag.loan_id}`} className={buttonClasses("secondary", "sm")}>
            Open loan {flag.ticket_number ? <span className="sr-only">{flag.ticket_number}</span> : null}
          </Link>
        )}
      </div>
    </Section>
  );
}

// 3. every status and note, oldest first, from the audit log (a new note never hides an earlier one)
function History({ flag }: { flag: FlagRow }) {
  return (
    <Section n={3} title="History" note="From the audit log. Earlier notes stay here after a new decision.">
      {flag.history.length ? (
        <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3">
          {flag.history.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <p>
                <span className="font-medium text-slate-900">{eventLabel(e, flag.history[i - 1] ?? null)}</span>
                <span className="text-slate-600">
                  {" "}
                  · {formatDateTime(e.at)} · {e.by ?? (e.action === "INSERT" ? "by the system or with the sample data" : "by an unknown account")}
                </span>
              </p>
              {e.note && <p className="italic text-slate-700">&ldquo;{e.note}&rdquo;</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-slate-600">No history in the audit log.</p>
      )}
    </Section>
  );
}

// SA6 + SA7: "Review flag" on a row that still needs a decision.
// Before (SA6): the note was optional for every decision and was pre-filled with the earlier note, so a Dismiss could
// go through with no reason or quietly replace the investigation note; the popup didn't know if another Admin had
// changed the flag after it was opened.
// Now: a reason (10+ characters) is required to Dismiss or Blacklist, checked here before the confirmation and again
// by the server and the database; the box starts empty (the earlier notes are in History); the popup sends the status
// it showed, and the database refuses if the flag changed since. The buttons stay at the bottom of the popup while it
// scrolls, with any error right above them.
export function ReviewFlagButton({ flag, label }: { flag: FlagRow; label: string }) {
  const box = useRef<HTMLDivElement>(null); // to close the popup after a save
  const [note, setNote] = useState(""); // the reason typed (kept if a save fails)
  const [noteError, setNoteError] = useState<string>(); // shown when Dismiss or Blacklist is pressed without a real reason
  const who = customerLabel(flag);
  const can = actionsFor(flag.status);
  const problem = reasonProblem(note);
  const clean = cleanNote(note);
  const noteId = `note-${flag.id}`;

  // Dismiss or Blacklist without a real reason: say what is missing and put the cursor in the box (nothing is sent)
  const askForReason = () => {
    setNoteError(problem ?? undefined);
    document.getElementById(noteId)?.focus();
  };

  // after a save: close the popup; if the row left the list, put the keyboard focus on the next Review button
  // (or the list heading), so a keyboard user is not dropped at the top of the page
  const afterSave = () => {
    box.current?.closest("dialog")?.close();
    window.setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return; // focus is still somewhere useful
      const next = document.querySelector<HTMLElement>("[data-review-button]") ?? document.getElementById("flag-queue");
      next?.focus();
    }, 700);
  };

  return (
    <PopupButton label={label} title="Review flag" ariaLabel={`Review the flag on ${who}`} dataAttr="review-button" wide>
      <div ref={box} className="text-sm">
        {/* the form holds the whole popup, not only part 4: the button bar can only stay stuck to the bottom while it
            is inside a box that reaches the bottom of the popup (with a small form, it stayed below at 1280 x 720) */}
        <ActionForm<ActionState> action={resolveSuspiciousFlag} showError={false} className="space-y-5" successMessage="Decision saved." onSuccess={afterSave}>
          {(state) => (
            <>
              <TheFlag flag={flag} />
              <Records flag={flag} />
              <History flag={flag} />
              <input type="hidden" name="flag_id" value={flag.id} />
              {/* the status this popup showed: the database refuses if another Admin changed it since */}
              <input type="hidden" name="expected_status" value={flag.status} />
              <Section n={4} title="Your decision">
                <TextareaField
                  id={noteId}
                  label="Reason for your decision"
                  name="resolution_notes"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (noteError) setNoteError(reasonProblem(e.target.value) ?? undefined); // the message goes away once it's fixed
                  }}
                  liveError={noteError}
                  placeholder="e.g. Customer showed the same ID as on file; the loans were for family members"
                  hint="Required to dismiss or blacklist (at least 10 characters). Optional for Mark investigating. Saved in the history with your name and the time."
                />
              </Section>

              {/* the buttons stay in view at the bottom while the popup scrolls; an error shows right above them */}
              <div className="sticky bottom-0 -mx-5 -mb-4 space-y-2 border-t border-slate-200 bg-white px-5 py-3">
                {state.error && (
                  <Alert tone="danger">
                    {state.error}{" "}
                    {/[Rr]eload/.test(state.error) && (
                      <button type="button" onClick={() => window.location.reload()} className="font-medium underline">
                        Reload now
                      </button>
                    )}
                  </Alert>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {can.dismiss &&
                    (problem ? (
                      // no real reason yet: the button explains instead of sending
                      <button type="button" onClick={askForReason} className={buttonClasses("secondary")}>
                        Dismiss flag
                      </button>
                    ) : (
                      <SubmitButton
                        name="decision"
                        value="dismissed"
                        variant="secondary"
                        pendingLabel="Saving"
                        confirm={{
                          title: `Dismiss the flag on ${who}?`,
                          message:
                            "This closes only this flag. It moves to Resolved and can't be reopened. Nothing else changes: the customer is not blocked, and a blacklist already on the customer stays.",
                          confirmLabel: "Dismiss flag",
                          tone: "primary",
                          details: [
                            ["Customer", who],
                            ["Reason", clean],
                          ],
                        }}
                      >
                        Dismiss flag
                      </SubmitButton>
                    ))}
                  {/* only on an Open flag: an Investigating flag can't be marked again */}
                  {can.investigate && (
                    <SubmitButton name="decision" value="investigating" pendingLabel="Saving">
                      Mark investigating
                    </SubmitButton>
                  )}
                  {/* set apart on the right (its own line on a phone): it blocks the customer */}
                  {can.blacklist && (
                    <span className="flex w-full justify-start border-t border-slate-200 pt-2 sm:ml-auto sm:w-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                      {problem ? (
                        <button type="button" onClick={askForReason} className={buttonClasses("danger", "sm")}>
                          Blacklist customer…
                        </button>
                      ) : (
                        <SubmitButton
                          name="decision"
                          value="blacklisted"
                          variant="danger"
                          size="sm"
                          pendingLabel="Saving"
                          confirm={{
                            title: `Blacklist ${who}?`,
                            message: flag.customer_blacklisted
                              ? "The customer is already blacklisted and keeps the reason saved before. This flag moves to Resolved as Blacklisted and can't be reopened."
                              : "New loans and new appraisals for this customer will be refused (the database checks it), and staff will see the reason below. Loans the customer already has don't change: they can still pay, renew and redeem them. The flag moves to Resolved and can't be reopened. An Admin can lift the blacklist with Remove from blacklist on the customer's page.",
                            confirmLabel: "Blacklist customer",
                            details: [
                              ["Customer", who],
                              [
                                "Blacklist reason",
                                flag.customer_blacklisted ? `Kept: ${flag.blacklist_reason ?? "no reason on file"}` : `Suspicious activity review: ${clean}`,
                              ],
                            ],
                          }}
                        >
                          Blacklist customer…
                        </SubmitButton>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </ActionForm>
      </div>
    </PopupButton>
  );
}

// SA6 + SA7: "View decision" on a resolved row: the outcome first, then the same three parts. No buttons to change it.
export function ViewDecisionButton({ flag }: { flag: FlagRow }) {
  const status = FLAG_STATUS[flag.status];
  return (
    <PopupButton label="View decision" title="Flag decision" ariaLabel={`View the decision on ${customerLabel(flag)}`} wide>
      <div className="space-y-5 text-sm">
        <dl className="grid gap-x-4 gap-y-2 rounded-md border border-slate-200 px-3 py-2 sm:grid-cols-3">
          <Info label="Decision">
            <Badge tone={status.tone}>{status.label}</Badge>
          </Info>
          <Info label="Decided">{flag.resolved_at ? formatDateTime(flag.resolved_at) : "Not recorded"}</Info>
          <Info label="By">{flag.resolved_by_name ?? "Not recorded"}</Info>
          <div className="sm:col-span-3">
            <Info label="Reason">{flag.resolution_notes ? <span className="italic">&ldquo;{flag.resolution_notes}&rdquo;</span> : "No reason was written."}</Info>
          </div>
        </dl>
        <TheFlag flag={flag} />
        <Records flag={flag} />
        <History flag={flag} />
        <p className="text-xs text-slate-600">A decided flag can&apos;t be changed or reopened.</p>
      </div>
    </PopupButton>
  );
}
