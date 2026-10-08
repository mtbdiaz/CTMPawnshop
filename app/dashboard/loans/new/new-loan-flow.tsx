"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, cx } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { formatPeso, manilaToday } from "@/lib/format";
import { addDaysIso, TERM_DAYS, termInterest } from "@/lib/loans/accrual";
import type { KaratPrices } from "@/lib/appraisal/valuation";
import { AppraisalCalculator, type SavedAppraisal } from "../../appraisals/appraisal-calculator";
import { createLoan, type ActionState } from "../actions";
import { searchCustomers, type CustomerHit } from "./actions";

export type PoolItem = { id: string; label: string; value: number; max: number };

export function NewLoanFlow({
  pool,
  prices,
  ltvPercent,
  interestRatePercent,
  initialCustomer = null,
  initialItemId,
}: {
  pool: PoolItem[];
  prices: KaratPrices;
  ltvPercent: number;
  interestRatePercent: number;
  initialCustomer?: CustomerHit | null;
  initialItemId?: string;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [items, setItems] = useState<PoolItem[]>(pool);
  const [item, setItem] = useState<PoolItem | null>(() => pool.find((p) => p.id === initialItemId) ?? null);
  const [itemMode, setItemMode] = useState<"pool" | "new">(pool.length ? "pool" : "new");
  const [itemQuery, setItemQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [vault, setVault] = useState("Vault A");

  const principal = Number(amount);
  const amountOk = item !== null && principal > 0 && principal <= item.max;
  const today = manilaToday();
  const interest = principal > 0 ? termInterest(principal, interestRatePercent) : 0;
  const blocked = customer?.is_blacklisted ?? false;

  const filteredItems = itemQuery.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(itemQuery.trim().toLowerCase()))
    : items;

  function onAppraised(saved: SavedAppraisal) {
    const next = { id: saved.id, label: saved.label, value: saved.value, max: saved.max };
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
                <p className="font-medium text-slate-900">{customer.full_name}</p>
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
          <div className="mt-3 flex gap-1.5" role="tablist">
            {(["pool", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={itemMode === m}
                onClick={() => setItemMode(m)}
                className={cx(
                  "rounded-md border px-3 py-1.5 text-sm",
                  itemMode === m ? "border-navy-700 bg-navy-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {m === "pool" ? `Available items (${items.length})` : "Appraise now"}
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
                placeholder="Search by category, karat or weight"
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
                      </span>
                      <span className="tabular-nums text-slate-600">max {formatPeso(i.max)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-3">
              <AppraisalCalculator prices={prices} ltvPercent={ltvPercent} onSaved={onAppraised} compact />
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
          <Field label="Vault location" name="vault_location" value={vault} onChange={(e) => setVault(e.target.value)} required />
          <dl className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <Row label={`Interest (${interestRatePercent}% per ${TERM_DAYS} days)`} value={principal > 0 ? formatPeso(interest) : "-"} />
            <Row label="Due" value={addDaysIso(today, TERM_DAYS)} />
            <Row label="To redeem on time" value={principal > 0 ? formatPeso(principal + interest) : "-"} strong />
          </dl>
          {blocked && <Alert tone="danger">This customer is blacklisted. A loan cannot be issued.</Alert>}
          <SubmitButton
            pendingLabel="Creating"
            disabled={!customer || !amountOk || blocked}
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
                ["Due", addDaysIso(today, TERM_DAYS)],
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
        setHits(res);
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
        {pending ? "Searching" : q.trim().length >= 2 && searched === q.trim() && !hits.length ? "No customer found. Register them under Customers first." : ""}
      </p>
    </div>
  );
}
