"use client";

import { appraisalNo, customerNo, parseRefNo } from "@/lib/ref-numbers"; // #18 + #29: short numbers
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link"; // NL5: Cancel goes back to the Loans list
import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { RequestIdInput } from "@/components/request-id"; // #40: one-time id, so the same form can't make two loans
import { Alert, Badge, Card, buttonClasses, cx } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { addDaysIso, TERM_DAYS, termInterest } from "@/lib/loans/accrual";
import type { KaratPrices } from "@/lib/appraisal/valuation";
import { AppraisalCalculator, type AppraisalDraft, type SavedAppraisal } from "../../appraisals/appraisal-calculator";
import { createLoan, type ActionState } from "../actions";
import { getCustomerHit, previewLoan, searchCustomers, type CustomerHit, type LoanPreview } from "./actions";
import { RegisterCustomerDialog } from "../../customers/register-dialog"; // RC2: the same Register customer popup

// customerId / owner: #38, the customer the item was appraised for (null = an older appraisal, anyone can pawn it)
// meta: NL8, when it was appraised and by whom (not set on an item appraised a moment ago on this page)
export type PoolItem = { id: string; label: string; value: number; max: number; customerId: string | null; owner: string | null; meta?: string };

export function NewLoanFlow({
  pool,
  prices,
  ltvPercent,
  interestRatePercent,
  graceDays,
  damagesPercent,
  initialCustomer = null,
  initialItemId,
  vaults,
}: {
  pool: PoolItem[];
  prices: KaratPrices;
  ltvPercent: number;
  interestRatePercent: number;
  graceDays: number; // LDU4: Settings, the grace days after the due date (fixed on the loan when it is created)
  damagesPercent: number; // LDU4: Settings, liquidated damages % per 30 days after the grace days (fixed on the loan when it is created)
  initialCustomer?: CustomerHit | null;
  initialItemId?: string;
  vaults: string[]; // #37: the active vault locations, from the database list
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [items, setItems] = useState<PoolItem[]>(pool);
  const [item, setItem] = useState<PoolItem | null>(() => pool.find((p) => p.id === initialItemId) ?? null);
  const [itemMode, setItemMode] = useState<"pool" | "new">(pool.length ? "pool" : "new");
  const [itemQuery, setItemQuery] = useState("");
  const [changingItem, setChangingItem] = useState(false); // NR3: true = an item is picked but the list is open to pick another
  const [amount, setAmount] = useState("");
  // #37: starts on Vault A when it is on the list, else on the first location
  const [vault, setVault] = useState(vaults.includes("Vault A") ? "Vault A" : (vaults[0] ?? ""));
  // TP1 (Matt, Nov 11): the item being typed in Appraise now, before it is saved (null = nothing picked yet)
  const [draft, setDraft] = useState<AppraisalDraft | null>(null);
  // #39: the terms as the database works them out, and which item + amount they are for
  const [preview, setPreview] = useState<{ key: string; terms: LoanPreview } | null>(null);

  // #38: an item appraised for one customer can only be pawned by that customer (the database refuses it too)
  const wrongOwner = Boolean(item?.customerId && customer && item.customerId !== customer.id);

  // TP1: Appraise now is open (no item picked, or Change item) and something is typed in it.
  // Terms then shows that item and its maximum right away, marked "not saved yet"
  const appraising = itemMode === "new" && (!item || changingItem);
  const shownDraft = appraising ? draft : null;
  // the maximum the amount is checked against: the unsaved item's while appraising, else the picked item's
  // TP2: a draft flagged for counterfeit review can't be used for this loan, so it gives no maximum to check against
  const shownMax = shownDraft ? (shownDraft.flagged ? null : shownDraft.max) : (item?.max ?? null);

  const principal = Number(amount);
  // NL7: checked while typing. Pesos have at most 2 decimals (centavos)
  const tooManyDecimals = /\.\d{3,}$/.test(amount.trim());
  const amountOk = item !== null && !wrongOwner && principal > 0 && principal <= item.max && !tooManyDecimals;
  const amountHint = !amount.trim()
    ? undefined
    : !(principal > 0)
      ? "Enter an amount above 0"
      : tooManyDecimals
        ? "Use at most 2 decimals (centavos)"
        : shownMax !== null && principal > shownMax
          ? `Above the maximum of ${formatPeso(shownMax)}`
          : shownMax !== null && (amountOk || shownDraft)
            ? `Within the maximum of ${formatPeso(shownMax)}` // NR6: say so when the amount is fine, too (TP1: also for the unsaved item)
            : undefined;

  // NL2 + NL10: what the Cashier should know about this customer before lending. Shown, not blocked:
  // the database only blocks blacklisted customers, and CTM gave no rule that stops a loan for an AML flag.
  const amlFlagged = customer?.aml_status === "flagged";
  const warnings: string[] = [];
  if (amlFlagged) warnings.push("AML flagged");
  if (customer?.history.hasWarnings) {
    const c = customer.history.counts;
    warnings.push([c.delinquent && `${c.delinquent} late`, c.reinstated && `${c.reinstated} reinstated`, c.defaulted && `${c.defaulted} defaulted`].filter(Boolean).join(", "));
  }

  // NL5: something was picked or typed, so leaving would lose it
  const [confirmLeave, setConfirmLeave] = useState(false);
  const dirty = Boolean(customer || item || amount.trim());
  // NL6: which steps are done
  const steps: [string, boolean][] = [
    ["Customer", Boolean(customer) && !blockedCustomer(customer)],
    ["Item", item !== null && !wrongOwner],
    ["Terms", amountOk && Boolean(vault)],
  ];
  // NR1: the step to work on now = the first one that isn't done (-1 when all three are done)
  const currentStep = steps.findIndex(([, done]) => !done);

  // NR5: why "Review and create loan" is switched off, in the order the form is filled in
  const missing: string[] = [];
  if (!customer) missing.push("pick a customer");
  else if (blockedCustomer(customer)) missing.push("pick a customer who is not blacklisted");
  if (shownDraft) missing.push("save the appraisal (Save appraisal, under the photos)"); // TP1: the item isn't saved yet
  else if (!item) missing.push("pick an item");
  else if (wrongOwner) missing.push("pick an item that belongs to this customer");
  if (!shownDraft && item && !wrongOwner && !amount.trim()) missing.push("enter the loan amount");
  else if (!shownDraft && item && !wrongOwner && !amountOk) missing.push("fix the loan amount");
  if (!vault) missing.push("choose a vault location");
  const today = manilaToday();

  // #39: ask the database for the terms a moment after the cashier stops typing (or picks another item)
  const previewKey = item && amountOk ? `${item.id}|${principal}` : "";
  useEffect(() => {
    if (!previewKey) return;
    const [itemId, amt] = previewKey.split("|");
    let stale = false; // true once the amount or item changed again: that answer is thrown away
    const t = setTimeout(async () => {
      const terms = await previewLoan(itemId, Number(amt));
      if (!stale && terms) setPreview({ key: previewKey, terms });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [previewKey]);

  // use the database's answer when it is for exactly this item and amount; until it arrives (or if it can't be
  // reached) show the app's own math, which follows the same rule
  const fromDb = preview && preview.key === previewKey ? preview.terms : null;
  const ratePercent = fromDb?.ratePercent ?? interestRatePercent;
  const interest = fromDb ? fromDb.interest : principal > 0 ? termInterest(principal, interestRatePercent) : 0;
  const due = fromDb?.due ?? addDaysIso(today, TERM_DAYS);
  const redeemOnTime = fromDb ? fromDb.redeemOnTime : principal + interest;
  const blocked = customer?.is_blacklisted ?? false;

  const itemRef = parseRefNo(itemQuery); // #29: "a45" / "A-0045" finds that one item
  // #38: once a customer is picked, the list shows that customer's items and the older ones with no customer
  const offered = customer ? items.filter((i) => !i.customerId || i.customerId === customer.id) : items;
  const filteredItems = itemQuery.trim()
    ? offered.filter((i) =>
        itemRef?.kind === "A" ? i.label.endsWith(appraisalNo(itemRef.n)) : i.label.toLowerCase().includes(itemQuery.trim().toLowerCase()),
      )
    : offered;

  // UI1: no item on this loan any more. The appraisal itself stays in Available items; the list opens again
  function unpickItem() {
    setItem(null);
    setChangingItem(false);
  }

  function onAppraised(saved: SavedAppraisal) {
    // NL3: an item flagged for counterfeit review can't be pawned until an Admin clears it, so it isn't picked
    // and isn't added to Available items. It is on the Appraisals page under Awaiting review.
    if (saved.flagged) return;
    // #38: "Appraise now" saves the item for the customer picked in step 1
    const next = { id: saved.id, label: saved.label, value: saved.value, max: saved.max, customerId: customer?.id ?? null, owner: customer?.full_name ?? null };
    setItems((prev) => [next, ...prev]);
    setItem(next);
    setChangingItem(false); // NR3: show the new item's summary
    setItemMode("pool");
  }

  return (
    <div className="space-y-4">
      {/* NL6: a small progress line: which of the 3 steps are done */}
      <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {steps.map(([name, done], i) => {
          // NR1: three looks. Done = green check. Current = navy number and bold name. Not started = grey.
          const current = i === currentStep;
          return (
            <li
              key={name}
              aria-current={current ? "step" : undefined} // screen readers say which step is the current one
              className={cx("flex items-center gap-1.5", done ? "font-medium text-emerald-800" : current ? "font-semibold text-navy-900" : "text-slate-500")}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                  done ? "bg-emerald-100 text-emerald-800" : current ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              {name}
              <span className="sr-only">{done ? "(done)" : current ? "(current step)" : "(not started)"}</span>
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <h2 className="text-sm font-semibold text-slate-900">1. Customer</h2>
            {customer ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {customer.full_name} <span className="font-mono text-xs font-normal text-slate-500">{customerNo(customer.customer_no)}</span>
                  </p>
                  {/* NR2: only what the Cashier needs to confirm the person: phone and the last 4 of the ID (never the full ID) */}
                  <p className="text-sm text-slate-600">
                    {customer.contact_number} · {customer.id_type} {customer.id_number}
                  </p>
                  {/* NR2: say it when the identity check is clear too (a flagged or blacklisted customer gets the warning below) */}
                  {!customer.is_blacklisted && customer.aml_status !== "flagged" && (
                    <p className="mt-1">
                      <Badge tone="success">AML clear</Badge>
                    </p>
                  )}
                </div>
                <button type="button" className="text-sm font-medium text-navy-700 underline" onClick={() => setCustomer(null)}>
                  Change customer
                </button>
              </div>
            ) : (
              <CustomerSearch onPick={setCustomer} />
            )}
            {customer && <HistoryPanel customer={customer} />}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-slate-900">2. Item</h2>
            {/* NR3: once an item is picked, the long list folds into a short summary with a Change button */}
            {item && !changingItem && (
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  {/* "Chain, 18K, 3.001 g · A-1296": category, karat, weight and the appraisal number */}
                  <p className="font-medium text-slate-900">{item.label}</p>
                  <p className="text-sm text-slate-600">
                    Appraised value {formatPeso(item.value)}
                    {item.meta ? ` · ${item.meta}` : " · Appraised just now"}
                  </p>
                  <p className="text-sm text-slate-600">
                    Maximum loan <span className="font-semibold tabular-nums text-navy-900">{formatPeso(item.max)}</span>
                  </p>
                  {wrongOwner && <p className="mt-1 text-sm font-medium text-red-700">Appraised for {item.owner ?? "another customer"}. Pick another item.</p>}
                </div>
                {/* UI1 (Wush, Nov 11): Change item opens the list again; Unselect takes the item off this loan (nothing is deleted) */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <button type="button" className="text-sm font-medium text-navy-700 underline" onClick={() => setChangingItem(true)}>
                    Change item
                  </button>
                  <button type="button" className="text-sm font-medium text-navy-700 underline" onClick={unpickItem}>
                    Unselect
                  </button>
                </div>
              </div>
            )}
            {/* the list and Appraise now: shown while nothing is picked, or after Change item */}
            {(!item || changingItem) && (
              <>
                {item && (
                  <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {/* UI1: says the old item is still on the loan until another one is picked */}
                    <span>
                      Still picked: <span className="font-medium text-slate-900">{item.label}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {/* UI1: was "Keep this item". Closes the list and keeps the item, like nothing happened */}
                      <button type="button" className="text-sm font-medium text-navy-700 underline" onClick={() => setChangingItem(false)}>
                        Cancel change
                      </button>
                      <button type="button" className="text-sm font-medium text-navy-700 underline" onClick={unpickItem}>
                        Unselect
                      </button>
                    </span>
                  </p>
                )}
                {/* D2: the same underline tab look as every page (was two solid navy buttons). They stay buttons, not links,
                    because they only switch what this card shows; nothing is saved and the page address doesn't change */}
                <div className="mt-3 flex flex-wrap gap-x-1 border-b border-slate-200" role="tablist" aria-label="Choose the item">
                  {(["pool", "new"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={itemMode === m} // screen readers say which one is open
                      onClick={() => setItemMode(m)}
                      className={cx(
                        // -mb-px = the navy line sits on the grey line under the row (same classes as components/view-tabs.tsx)
                        "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500",
                        itemMode === m ? "border-navy-700 font-semibold text-navy-900" : "border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900",
                      )}
                    >
                      {/* the name; Available items also shows how many, small and grey like the other tab counts */}
                      {m === "pool" ? "Available items" : "Appraise now"}
                      {m === "pool" && <span className="text-xs font-normal tabular-nums text-slate-500">{offered.length}</span>}
                    </button>
                  ))}
                </div>
                {itemMode === "pool" ? (
                  <div className="mt-3">
                    <label htmlFor="item-search" className="sr-only">
                      Search available items
                    </label>
                    <input
                      id="item-search"
                      type="search"
                      value={itemQuery}
                      onChange={(e) => setItemQuery(e.target.value)}
                      placeholder="Search by category, karat, weight or A-number"
                      className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                      {filteredItems.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No available items match. Use Appraise now.</li>}
                      {filteredItems.map((i) => (
                        <li key={i.id}>
                          <label className={cx("flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm", item?.id === i.id ? "bg-navy-50" : "hover:bg-slate-50")}>
                            <span className="flex items-start gap-2">
                              <input
                                type="radio"
                                name="pick-item"
                                className="mt-1"
                                checked={item?.id === i.id}
                                onChange={() => {
                                  setItem(i);
                                  setChangingItem(false); // NR3: picked -> fold the list into the summary
                                }}
                              />
                              <span>
                                {/* NR4: the item name is the main line; the details under it are smaller and grey */}
                                <span className="font-medium text-slate-900">{i.label}</span>
                                {/* #38: before a customer is picked, say whose item it is */}
                                {!customer && i.owner && <span className="ml-2 text-xs text-slate-500">for {i.owner}</span>}
                                {/* NL8: value + when and by whom it was appraised, to tell similar items apart */}
                                <span className="block text-xs text-slate-500">
                                  Value {formatPeso(i.value)}
                                  {i.meta ? ` · ${i.meta}` : " · Appraised just now"}
                                </span>
                              </span>
                            </span>
                            <span className="tabular-nums text-slate-600">max {formatPeso(i.max)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-3">
                    {/* NL3: the same full form as New appraisal (notes, photos, counterfeit flag), saved for the customer in step 1 */}
                    <AppraisalCalculator prices={prices} ltvPercent={ltvPercent} onSaved={onAppraised} forCustomer={customer} onDraft={setDraft} />
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* NR8: on a wide and tall screen the Terms card stays in view while the left side scrolls. Only when the
            screen is at least 900px tall, so the whole card always fits and nothing is cut off. top-16 = just under the
            top bar, which also stays in place */}
        <Card className="xl:self-start [@media(min-width:1280px)_and_(min-height:900px)]:sticky [@media(min-width:1280px)_and_(min-height:900px)]:top-16">
          <h2 className="text-sm font-semibold text-slate-900">3. Terms</h2>
          <ActionForm
            action={createLoan}
            className="mt-3 space-y-4"
            successMessage="Loan created."
            onSuccess={(s: ActionState) => s.id && router.push(`/dashboard/loans/${s.id}`)}
          >
            <input type="hidden" name="customer_id" value={customer?.id ?? ""} />
            <input type="hidden" name="appraisal_item_id" value={item?.id ?? ""} />
            {/* #40: a new id for every customer + item pair. Pressing Create twice, or a retry, sends the same id and
                the database returns the first loan instead of making a second one */}
            <RequestIdInput key={`${customer?.id ?? ""}|${item?.id ?? ""}`} />
            <dl className="space-y-1 text-sm">
              <Row label="Customer" value={customer?.full_name ?? "Not selected"} />
              {/* TP1: while appraising, the item being typed shows here right away, marked "not saved yet" */}
              <Row label="Item" value={shownDraft ? `${shownDraft.label} (not saved yet)` : (item?.label ?? "Not selected")} />
              <Row label="Maximum loan" value={shownMax !== null ? formatPeso(shownMax) : shownDraft?.flagged ? "Not for this loan" : "-"} />
            </dl>
            {/* TP1: what to do next with the unsaved item. A flagged item can't be used for a loan */}
            {shownDraft && (
              <p role="status" className="-mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {shownDraft.flagged
                  ? "Flagged for counterfeit review. After saving, it goes to Awaiting review and can't be used for this loan."
                  : shownDraft.max === null
                    ? "Pick the karat and enter the weight to see the maximum loan."
                    : "Not saved yet. Press Save appraisal (under the photos) to use this item for the loan."}
              </p>
            )}
            <Field
              label="Loan amount (₱)"
              name="principal_amount"
              type="number"
              step="0.01"
              min="0.01"
              max={item?.max}
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={amountHint}
            />
            {/* NL7: fills the box only when clicked; the Cashier can still type a lower amount */}
            {shownMax !== null && !(shownDraft?.flagged) && !(!shownDraft && wrongOwner) && (
              <button type="button" onClick={() => setAmount(String(shownMax))} className="-mt-2 rounded-sm text-sm font-medium text-navy-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                Use maximum ({formatPeso(shownMax)})
              </button>
            )}
            {/* #37: a list instead of a free text box, so "vault a", "Vault-A" and typos can't happen any more */}
            <SelectField
              label="Vault location"
              name="vault_location"
              value={vault}
              onChange={(e) => setVault(e.target.value)}
              required
              // MF5 (Matt, Nov 14): no "An Admin can add locations in Settings." line under the list
            >
              {vaults.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
            {!vaults.length && <Alert tone="warning">No vault location is switched on. An Admin must add one in Settings before a loan can be made.</Alert>}
            <dl className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <Row label={`Interest (${ratePercent}% per ${TERM_DAYS} days)`} value={principal > 0 ? formatPeso(interest) : "-"} />
              <Row label="Due" value={formatDate(due)} />
              <Row label="To redeem on time" value={principal > 0 ? formatPeso(redeemOnTime) : "-"} strong />
            </dl>
            {/* NR7: say where the numbers come from. The loan's real terms are set by the database when it is created */}
            {principal > 0 && (amountOk || shownDraft) && (
              <p className="-mt-2 text-xs text-slate-500" aria-live="polite">
                {shownDraft
                  ? "Estimate. The database works out the terms once the appraisal is saved." // TP1: no saved item to ask about yet
                  : fromDb
                    ? "Worked out by the database for this amount. The final terms are set when the loan is created."
                    : "Estimate. Checking with the database."}
              </p>
            )}
            {/* LDU4 (Nov 14): what happens if the customer is late (liquidated damages, 0073), with today's Settings values so
                the Cashier can explain it at the counter. One short line, under the summary */}
            {damagesPercent > 0 && (
              <p className="-mt-2 text-xs text-slate-600">
                <span className="font-medium text-slate-700">If late:</span> if not paid or renewed by {formatDate(addDaysIso(due, graceDays))} (the
                due date + {graceDays} grace day{graceDays === 1 ? "" : "s"}), liquidated damages of {damagesPercent}% of the unpaid principal are
                added for every {TERM_DAYS} days. Any part of {TERM_DAYS} days counts as a full {TERM_DAYS} days.
              </p>
            )}
            {blocked && <Alert tone="danger">This customer is blacklisted. A loan cannot be issued.</Alert>}
            {/* #38: the picked item belongs to someone else's appraisal */}
            {wrongOwner && (
              <Alert tone="danger">
                This item was appraised for {item?.owner ?? "another customer"}. Pick that customer or another item. An Appraiser or Admin can change the customer on the appraisal.
              </Alert>
            )}
            {/* the two buttons side by side */}
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton
                pendingLabel="Creating"
                disabled={!customer || !amountOk || blocked || !vault || Boolean(shownDraft)} // TP1: not while an unsaved item is being appraised
                confirm={{
                  title: "Review the loan",
                  message: "Check every line with the customer before you confirm.",
                  confirmLabel: "Create loan",
                  tone: "primary",
                  locked: true,
                  details: [
                    ["Customer", customer?.full_name ?? ""],
                    ["Item", item?.label ?? ""],
                    ["Loan amount", formatPeso(principal)],
                    ["Interest", formatPeso(interest)],
                    ["Due", formatDate(due)], // NL4: "Dec 10, 2026"
                    ["To redeem on time", formatPeso(redeemOnTime)],
                    ["Vault", vault],
                    // NL10: the warnings again, right before the loan is made
                    ...(warnings.length ? ([["Warnings", warnings.join(" · ")]] as [string, string][]) : []),
                  ],
                }}
              >
                Review and create loan
              </SubmitButton>
              {/* NL5: Cancel. With nothing filled in it just leaves; otherwise it asks first */}
              {dirty ? (
                <button type="button" onClick={() => setConfirmLeave(true)} className={buttonClasses("secondary")}>
                  Cancel
                </button>
              ) : (
                <Link href="/dashboard/loans" className={buttonClasses("secondary")}>
                  Cancel
                </Link>
              )}
            </div>
            {/* NR5: the button is off -> say exactly what is still needed */}
            {missing.length > 0 && (
              <p id="loan-missing" className="text-sm text-slate-600">
                To continue: {missing.join(", ")}.
              </p>
            )}
            {confirmLeave && (
              <div role="alertdialog" aria-labelledby="discard-loan-title" aria-describedby="discard-loan-text" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p id="discard-loan-title" className="font-semibold">
                  Discard this loan?
                </p>
                <p id="discard-loan-text" className="mt-0.5">
                  What you picked and typed will be lost. No loan has been made. An appraisal you saved with Appraise now is kept.
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" autoFocus onClick={() => setConfirmLeave(false)} className={buttonClasses("secondary", "sm")}>
                    Continue editing
                  </button>
                  <button type="button" onClick={() => router.push("/dashboard/loans")} className={buttonClasses("danger", "sm")}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

// NL6: a blacklisted customer can't get a loan, so the Customer step isn't "done"
function blockedCustomer(c: CustomerHit | null) {
  return Boolean(c?.is_blacklisted);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cx("text-right tabular-nums", strong && "font-semibold text-navy-900")}>{value}</dd>
    </div>
  );
}

function HistoryPanel({ customer }: { customer: CustomerHit }) {
  const { counts, score, tier, hasWarnings } = customer.history;
  return (
    <div className="mt-4 space-y-3">
      {customer.is_blacklisted && <Alert tone="danger">Blacklisted{customer.blacklist_reason ? `: ${customer.blacklist_reason}` : ""}.</Alert>}
      {/* NL2: shown, not blocked. The reason is on the customer's profile */}
      {customer.aml_status === "flagged" && (
        <Alert tone="warning" title="AML identity check flagged this customer">
          Check the customer&apos;s ID and profile before you lend. A loan is still allowed.
        </Alert>
      )}
      {hasWarnings && (
        <Alert tone="warning">
          History warning: {[counts.delinquent && `${counts.delinquent} late`, counts.reinstated && `${counts.reinstated} reinstated`, counts.defaulted && `${counts.defaulted} defaulted`]
            .filter(Boolean)
            .join(", ")}
          .
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ScoreBadge score={score} tier={tier} />
        <span className="text-slate-600">
          {counts.total} loans · {counts.active} open · {counts.redeemed} redeemed · {counts.renewed} renewed · {counts.overdue} overdue now
        </span>
      </div>
    </div>
  );
}

/** Search-as-you-type with arrow-key navigation (combobox pattern). */
function CustomerSearch({ onPick }: { onPick: (c: CustomerHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const [limited, setLimited] = useState(false); // #22: true = too many searches this minute, the server didn't search
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchCustomers(term);
        if (mine !== seq.current) return;
        const overLimit = !Array.isArray(res); // #22: the server answered "too many searches" instead of a list
        setLimited(overLimit);
        setHits(overLimit ? [] : res);
        setActive(0);
        setSearched(term);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length >= 2 ? hits : [];

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!shown.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onPick(shown[active]);
    }
  }

  return (
    <div className="mt-3">
      <label htmlFor="customer-search" className="block text-sm font-medium text-slate-700">
        Name, phone or ID number
      </label>
      <input
        id="customer-search"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type at least 2 characters"
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <ul id={listId} role="listbox" className={cx("mt-2 divide-y divide-slate-100 rounded-md border border-slate-200", !shown.length && "hidden")}>
        {shown.map((c, i) => (
          <li
            key={c.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            className={cx("flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm", i === active && "bg-navy-50")}
          >
            <span>
              <span className="font-medium text-slate-900">{c.full_name}</span>
              {/* #18: the short customer number */}
              <span className="ml-1.5 font-mono text-xs text-slate-500">{customerNo(c.customer_no)}</span>
              <span className="ml-2 text-slate-600">
                {c.contact_number} · {c.id_number}
              </span>
            </span>
            <span className="flex gap-1.5">
              {c.is_blacklisted && <Badge tone="danger">Blacklisted</Badge>}
              {c.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
              {c.history.hasWarnings && <Badge tone="warning">Warnings</Badge>}
              <ScoreBadge score={c.history.score} tier={c.history.tier} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500" aria-live="polite">
        {pending
          ? "Searching"
          : limited && searched === q.trim() // #22: don't say "No customer found" when the search didn't run
            ? "Too many searches. Wait a minute, then try again."
            : q.trim().length >= 2 && searched === q.trim() && !hits.length
              ? "No customer found. Register them with the button below."
              : shown[0]?.similar // #16: the list above holds close names, not exact matches
                ? "No exact match. These are similar names: check the name and ID before you pick one."
                : ""}
      </p>
      {/* RC2: Matt's request. The person isn't found (or isn't among the similar names): register them here, without
          leaving New Loan. The popup is the same form as on Customers (ID and phone duplicate checks, AML check).
          After saving, the new customer is picked in step 1 and the loan continues */}
      {q.trim().length >= 2 && searched === q.trim() && !limited && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>{hits.length ? "Not the right person?" : "New customer?"}</span>
          <RegisterCustomerDialog
            small
            label="Register new customer"
            // a typed name (letters, no digits) starts the Full name box; a phone or ID number doesn't
            defaultName={/[a-z]/i.test(q) && !/\d/.test(q) ? q.trim() : undefined}
            onRegistered={async (id) => {
              const hit = await getCustomerHit(id); // the new customer, with the masked ID and history
              if (hit) onPick(hit);
            }}
          />
        </div>
      )}
    </div>
  );
}
