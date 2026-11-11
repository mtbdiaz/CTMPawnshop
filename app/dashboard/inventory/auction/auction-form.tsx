"use client"; // runs in the browser: ticking items, typing reserve prices, the review step

import { useMemo, useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { RequestIdInput } from "@/components/request-id"; // a double click makes one batch
import { Badge, buttonClasses, cx } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { appraisedText, batchNo, eligibility, itemRef, itemTitle, parsePeso, reserveProblem, type PrepareItem } from "@/lib/inventory/auction";
import { createAuctionBatch, type ActionState } from "../actions";
import { ItemDetails } from "./auction-parts";

const PAGE = 10; // items per page, same as the other lists

// PB-26 + UC18 + AP1 (migration 0052): the "Prepare items" tab.
// Before: tick items, optionally type a minimum price, press Create (an empty price quietly meant "no minimum").
// Now, in order: 1. tick eligible items · 2. give each one a reserve price or tick "No reserve" · 3. Review batch
// (a summary of exactly what will be saved) · 4. Create batch. The database checks every item again when saving.
export function AuctionForm({ items }: { items: PrepareItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()); // ticked item ids (kept when the page or search changes)
  const [prices, setPrices] = useState<Record<string, string>>({}); // item id -> the typed reserve price
  const [none, setNone] = useState<Record<string, boolean>>({}); // item id -> "No reserve" ticked
  const [q, setQ] = useState(""); // the search box (filters the list in the browser; the list is already loaded)
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(false); // false = picking items, true = the review step
  const [meta, setMeta] = useState({ date: "", place: "", notes: "" }); // the auction date, place and batch notes (all optional)
  const [formKey, setFormKey] = useState(0); // changes after a batch is made, so the next batch gets a new request id

  const eligible = useMemo(() => items.filter((i) => eligibility(i).ok), [items]); // only these can be ticked
  // search by description, A-number, ticket, customer or location
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => [itemTitle(i), itemRef(i), i.ticket_number, i.customer_name, i.vault_location].some((v) => (v ?? "").toLowerCase().includes(s)));
  }, [items, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const pageItems = shown.slice((current - 1) * PAGE, current * PAGE);

  // the ticked items, in list order, and what is still wrong with each one's reserve
  const picked = items.filter((i) => selected.has(i.id) && eligibility(i).ok);
  const problems = picked.filter((i) => reserveProblem(prices[i.id] ?? "", none[i.id] ?? false));
  const allTicked = eligible.length > 0 && eligible.every((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <ActionForm<ActionState>
      key={formKey}
      action={createAuctionBatch}
      className="space-y-4"
      successMessage="Auction batch created. Its items are now under Queued items."
      onSuccess={() => {
        // start clean for the next batch
        setSelected(new Set());
        setPrices({});
        setNone({});
        setMeta({ date: "", place: "", notes: "" });
        setReview(false);
        setFormKey((k) => k + 1);
      }}
    >
      {(state) => (
        <>
          <RequestIdInput />
          {/* what is sent: every ticked item with its reserve, also the ones on another page of the list */}
          {picked.map((i) => (
            <span key={i.id}>
              <input type="hidden" name="item_id" value={i.id} />
              <input type="hidden" name={`min_price_${i.id}`} value={none[i.id] ? "" : (prices[i.id] ?? "")} />
              {none[i.id] && <input type="hidden" name={`no_reserve_${i.id}`} value="on" />}
            </span>
          ))}

          {/* HR1: the steps in one line. Exactly one is the current step (filled navy circle, bold, underlined);
              finished steps get a tick; later steps are grey. Words say the state too, so color is not the only signal. */}
          <ol aria-label="Steps to create a batch" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {["Select items", "Set reserve prices", "Review batch", "Create batch"].map((name, n) => {
              const now = review ? 2 : picked.length > 0 ? 1 : 0; // the step being done: 0 select, 1 set prices, 2 review
              const state = n < now ? "done" : n === now ? "current" : "next";
              return (
                <li key={name} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-1.5">
                  {n > 0 && <span aria-hidden="true" className="mr-0.5 text-slate-400">→</span>}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      state === "current" && "bg-navy-700 text-white",
                      state === "done" && "bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-300",
                      state === "next" && "bg-slate-100 text-slate-500",
                    )}
                  >
                    {state === "done" ? "✓" : n + 1}
                  </span>
                  <span className={cx(state === "current" ? "font-semibold text-navy-900 underline decoration-2 underline-offset-4" : state === "done" ? "text-slate-700" : "text-slate-500")}>
                    {name}
                    <span className="sr-only">{state === "current" ? " (current step)" : state === "done" ? " (done)" : " (not yet)"}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {!review ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={allTicked}
                    disabled={eligible.length === 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(eligible.map((i) => i.id)) : new Set())}
                    className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
                  />
                  {/* only items that passed the system checks: a blocked item is never ticked by "Select all" */}
                  Select all that passed checks ({eligible.length})
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {items.length > PAGE && (
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Search item, A-number, ticket, customer"
                      aria-label="Search forfeited items"
                      className="w-64 max-w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
                    />
                  )}
                  <span aria-live="polite" className="text-sm text-slate-600">
                    {selected.size} selected
                  </span>
                </div>
              </div>

              <ul className="divide-y divide-slate-100">
                {pageItems.map((item) => {
                  const e = eligibility(item);
                  const on = selected.has(item.id) && e.ok; // ticked = goes in the batch
                  const title = itemTitle(item);
                  const ref = itemRef(item);
                  const problem = on ? (state.fieldErrors?.[`min_price_${item.id}`] ?? null) : null; // from the server, after a failed save
                  return (
                    <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!e.ok}
                        onChange={(ev) => toggle(item.id, ev.target.checked)}
                        aria-label={`Select ${title}${ref ? `, ${ref}` : ""}`}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-navy-700 focus:ring-navy-500 disabled:opacity-40"
                      />
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
                          {title}
                          {ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">{ref}</span>}
                          {/* the word says it; the color only supports it */}
                          <Badge tone={e.tone}>{e.label}</Badge>
                        </p>
                        <p className="text-xs text-slate-600">
                          {item.ticket_number ?? "No loan"} · pawned by {item.customer_name ?? "customer not available"} · {item.vault_location ?? "No location"} · appraised{" "}
                          {appraisedText(item.computed_value)}
                        </p>
                        {/* why it is blocked or needs a look, and when it was in a batch before */}
                        {e.tone !== "info" && <p className={cx("text-xs", e.ok ? "text-amber-800" : "text-red-700")}>{e.why}</p>}
                        {item.last_unsold && (
                          <p className="text-xs text-slate-600">
                            Not sold in {batchNo(item.last_unsold.batch_no)} on {formatDate(item.last_unsold.at)} (reserve then:{" "}
                            {item.last_unsold.no_reserve ? "no reserve" : item.last_unsold.min_price != null ? formatPeso(item.last_unsold.min_price) : "not set"}): &ldquo;
                            {item.last_unsold.reason}&rdquo;
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        {/* the reserve: a price, or the "No reserve" tick. Only for ticked items */}
                        <div>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={none[item.id] ? "" : (prices[item.id] ?? "")}
                            onChange={(ev) => setPrices((p) => ({ ...p, [item.id]: ev.target.value }))}
                            disabled={!on || none[item.id]}
                            placeholder={on && none[item.id] ? "No reserve" : "Reserve price (₱)"}
                            aria-label={`Reserve price for ${title}${ref ? `, ${ref}` : ""}`}
                            aria-invalid={problem ? true : undefined}
                            className={cx(
                              "w-40 rounded-md border px-3 py-1.5 text-sm tabular-nums placeholder:text-slate-500 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400",
                              problem ? "border-red-500 focus:ring-red-500/30" : "border-slate-300 focus:border-navy-500 focus:ring-navy-500/20",
                            )}
                          />
                          {/* HR1: the whole line is the click / tap target (36px high), not only the small box.
                              Ticking it switches the price box off but KEEPS what was typed; unticking brings it back. */}
                          <label
                            className={cx(
                              "mt-1 flex min-h-9 w-40 items-center gap-2 rounded-md px-2 text-sm",
                              on ? "cursor-pointer text-slate-800 hover:bg-slate-50" : "text-slate-400",
                              on && none[item.id] && "bg-navy-50 font-medium text-navy-900",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={on && (none[item.id] ?? false)}
                              disabled={!on}
                              onChange={(ev) => setNone((p) => ({ ...p, [item.id]: ev.target.checked }))}
                              aria-label={`No reserve for ${title}${ref ? `, ${ref}` : ""}`}
                              className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
                            />
                            No reserve
                          </label>
                          {problem && (
                            <p role="alert" className="mt-1 max-w-40 text-xs text-red-700">
                              {problem}
                            </p>
                          )}
                        </div>
                        <ItemDetails item={item} />
                      </div>
                    </li>
                  );
                })}
                {pageItems.length === 0 && <li className="py-6 text-center text-sm text-slate-600">No forfeited item matches &ldquo;{q}&rdquo;.</li>}
              </ul>

              {/* pages of the list (the ticks are kept when you change page) */}
              {pages > 1 && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>
                    Page {current} of {pages} · {shown.length} items
                  </span>
                  <span className="flex gap-2">
                    <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className={buttonClasses("secondary", "sm")}>
                      Previous
                    </button>
                    <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} className={buttonClasses("secondary", "sm")}>
                      Next
                    </button>
                  </span>
                </div>
              )}

              <p className="text-xs text-slate-600">
                Reserve price: the lowest amount the item may be sold for (a sale below it is refused). &ldquo;No reserve&rdquo; means it may be sold at any price; tick it
                only when that was decided on purpose (a typed price is kept if you untick it). The appraised value is a guide and is never used as the reserve by itself.
                &ldquo;System checks passed&rdquo; means the item is forfeited by an Admin, its records are complete, it is not in another batch and it has no open audit problem.
                It does not cover the auction notice and publication; confirm those outside the system.
              </p>

              {/* the auction details, all optional (the batch can be made before the date is known) */}
              <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Auction date (optional)" name="auction_date" type="date" value={meta.date} onChange={(e) => setMeta((m) => ({ ...m, date: e.target.value }))} />
                <Field label="Auction place (optional)" name="auction_place" maxLength={120} value={meta.place} onChange={(e) => setMeta((m) => ({ ...m, place: e.target.value }))} placeholder="e.g. CTM Pawnshop, Kiblawan" />
                <Field label="Batch notes (optional)" name="notes" maxLength={500} value={meta.notes} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} placeholder="e.g. November auction lot" />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={picked.length === 0 || problems.length > 0}
                  onClick={() => setReview(true)}
                  className={buttonClasses("primary")}
                >
                  Review batch
                </button>
                {/* why the button is off, in words */}
                <span aria-live="polite" className="text-sm text-slate-600">
                  {picked.length === 0
                    ? "Tick at least one item that passed the checks."
                    : problems.length > 0
                      ? `${problems.length} selected item${problems.length === 1 ? "" : "s"} still need${problems.length === 1 ? "s" : ""} a valid reserve price or "No reserve".`
                      : `${picked.length} item${picked.length === 1 ? "" : "s"} ready to review.`}
                </span>
              </div>
            </>
          ) : (
            <>
              {/* the boxes of step 2 are not on the screen now, so their values are sent from here */}
              <input type="hidden" name="auction_date" value={meta.date} />
              <input type="hidden" name="auction_place" value={meta.place} />
              <input type="hidden" name="notes" value={meta.notes} />
              <Review items={picked} prices={prices} none={none} meta={meta} onBack={() => setReview(false)} />
            </>
          )}
        </>
      )}
    </ActionForm>
  );
}

// Step 3: exactly what will be saved. Nothing is created until "Create batch" is pressed here.
function Review({
  items,
  prices,
  none,
  meta,
  onBack,
}: {
  items: PrepareItem[];
  prices: Record<string, string>;
  none: Record<string, boolean>;
  meta: { date: string; place: string; notes: string };
  onBack: () => void;
}) {
  const total = items.reduce((t, i) => t + (none[i.id] ? 0 : (parsePeso(prices[i.id] ?? "") ?? 0)), 0);
  const noReserve = items.filter((i) => none[i.id]).length;
  const warnings = items.filter((i) => i.audit_flag === "found_elsewhere");
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-900">
            {items.length} item{items.length === 1 ? "" : "s"} in this batch
          </caption>
          <thead className="text-left text-xs text-slate-600">
            <tr className="border-b border-slate-200">
              <th scope="col" className="px-3 py-2 font-medium">Item</th>
              <th scope="col" className="px-3 py-2 font-medium">Pawn ticket</th>
              <th scope="col" className="px-3 py-2 font-medium">Location</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Appraised</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Reserve price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2">
                  {itemTitle(i)} {itemRef(i) && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{itemRef(i)}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{i.ticket_number ?? "No loan"}</td>
                <td className="px-3 py-2">{i.vault_location ?? ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{appraisedText(i.computed_value)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{none[i.id] ? "No reserve" : formatPeso(parsePeso(prices[i.id] ?? "") ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormSummary total={total} priced={items.length - noReserve} noReserve={noReserve} />
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Auction date</dt>
          <dd className="text-slate-900">{meta.date ? formatDate(meta.date) : "Not set yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Auction place</dt>
          <dd className="break-words text-slate-900">{meta.place.trim() || "Not set yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Batch notes</dt>
          <dd className="break-words text-slate-900">{meta.notes.trim() || "None"}</dd>
        </div>
      </dl>
      {warnings.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warnings.length} item{warnings.length === 1 ? " was" : "s were"} found in a different place in the last physical audit ({warnings.map((w) => itemRef(w) || itemTitle(w)).join(", ")}).
          Check where {warnings.length === 1 ? "it is" : "they are"} before the auction.
        </p>
      )}
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
        <li>The items become &ldquo;Queued for auction&rdquo;. They stay in the vault.</li>
        <li>Each item is checked again when you press Create batch. If one no longer passes the checks, nothing is saved.</li>
        <li>The customer notice and the public notice of the auction are not tracked in this system. Make sure they were done before the auction.</li>
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <button type="button" onClick={onBack} className={buttonClasses("secondary")}>
          Back to edit
        </button>
        <SubmitButton pendingLabel="Creating batch">Create batch</SubmitButton>
      </div>
    </div>
  );
}

// the totals line of the review
function FormSummary({ total, priced, noReserve }: { total: number; priced: number; noReserve: number }) {
  return (
    <p className="text-sm text-slate-700">
      {priced > 0 && (
        <>
          Reserve prices total <span className="font-semibold tabular-nums text-slate-900">{formatPeso(total)}</span> for {priced} item{priced === 1 ? "" : "s"}
        </>
      )}
      {priced > 0 && noReserve > 0 && " · "}
      {noReserve > 0 && (
        <>
          <span className="font-semibold text-slate-900">{noReserve}</span> with no reserve (any price)
        </>
      )}
      .
    </p>
  );
}
