"use client";

import { appraisalNo, customerNo, parseRefNo } from "@/lib/ref-numbers"; // #18 + #29: short numbers
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { RequestIdInput } from "@/components/request-id"; // #40: one-time id, so the same form can't make two loans
import { Alert, Badge, Card, cx } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { formatPeso, manilaToday } from "@/lib/format";
import { addDaysIso, TERM_DAYS, termInterest } from "@/lib/loans/accrual";
import type { KaratPrices } from "@/lib/appraisal/valuation";
import { AppraisalCalculator, type SavedAppraisal } from "../../appraisals/appraisal-calculator";
import { createLoan, type ActionState } from "../actions";
import { previewLoan, searchCustomers, type CustomerHit, type LoanPreview } from "./actions";

// customerId / owner: #38, the customer the item was appraised for (null = an older appraisal, anyone can pawn it)
export type PoolItem = { id: string; label: string; value: number; max: number; customerId: string | null; owner: string | null };

export function NewLoanFlow({
  pool,
  prices,
  ltvPercent,
  interestRatePercent,
  initialCustomer = null,
  initialItemId,
  vaults,
}: {
  pool: PoolItem[];
  prices: KaratPrices;
  ltvPercent: number;
  interestRatePercent: number;
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
  const [amount, setAmount] = useState("");
  // #37: starts on Vault A when it is on the list, else on the first location
  const [vault, setVault] = useState(vaults.includes("Vault A") ? "Vault A" : (vaults[0] ?? ""));
  // #39: the terms as the database works them out, and which item + amount they are for
  const [preview, setPreview] = useState<{ key: string; terms: LoanPreview } | null>(null);

  // #38: an item appraised for one customer can only be pawned by that customer (the database refuses it too)
  const wrongOwner = Boolean(item?.customerId && customer && item.customerId !== customer.id);

  const principal = Number(amount);
  const amountOk = item !== null && !wrongOwner && principal > 0 && principal <= item.max;
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

  function onAppraised(saved: SavedAppraisal) {
    // #38: "Appraise now" saves the item for the customer picked in step 1
    const next = { id: saved.id, label: saved.label, value: saved.value, max: saved.max, customerId: customer?.id ?? null, owner: customer?.full_name ?? null };
    setItems((prev) => [next, ...prev]);
    setItem(next);
    setItemMode("pool");
  }

  return (
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
                <p className="text-sm text-slate-600">
                  {customer.contact_number} · {customer.id_type} {customer.id_number}
                </p>
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
                      <span className="flex items-center gap-2">
                        <input type="radio" name="pick-item" checked={item?.id === i.id} onChange={() => setItem(i)} />
                        {i.label}
                        {/* #38: before a customer is picked, say whose item it is */}
                        {!customer && i.owner && <span className="text-xs text-slate-500">for {i.owner}</span>}
                      </span>
                      <span className="tabular-nums text-slate-600">max {formatPeso(i.max)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-3">
              <AppraisalCalculator prices={prices} ltvPercent={ltvPercent} onSaved={onAppraised} compact forCustomer={customer} />
            </div>
          )}
        </Card>
      </div>

      <Card className="xl:self-start">
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
            <Row label="Item" value={item?.label ?? "Not selected"} />
            <Row label="Maximum loan" value={item ? formatPeso(item.max) : "-"} />
          </dl>
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
            hint={item && principal > item.max ? `Above the maximum of ${formatPeso(item.max)}` : undefined}
          />
          {/* #37: a list instead of a free text box, so "vault a", "Vault-A" and typos can't happen any more */}
          <SelectField
            label="Vault location"
            name="vault_location"
            value={vault}
            onChange={(e) => setVault(e.target.value)}
            required
            hint={vaults.length ? "An Admin can add locations in Settings." : undefined}
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
            <Row label="Due" value={due} />
            <Row label="To redeem on time" value={principal > 0 ? formatPeso(redeemOnTime) : "-"} strong />
          </dl>
          {blocked && <Alert tone="danger">This customer is blacklisted. A loan cannot be issued.</Alert>}
          {/* #38: the picked item belongs to someone else's appraisal */}
          {wrongOwner && (
            <Alert tone="danger">
              This item was appraised for {item?.owner ?? "another customer"}. Pick that customer or another item. An Appraiser or Admin can change the customer on the appraisal.
            </Alert>
          )}
          <SubmitButton
            pendingLabel="Creating"
            disabled={!customer || !amountOk || blocked || !vault}
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
                ["Due", due],
                ["To redeem on time", formatPeso(redeemOnTime)],
                ["Vault", vault],
              ],
            }}
          >
            Review and create loan
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
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
              ? "No customer found. Register them under Customers first."
              : shown[0]?.similar // #16: the list above holds close names, not exact matches
                ? "No exact match. These are similar names: check the name and ID before you pick one."
                : ""}
      </p>
    </div>
  );
}
