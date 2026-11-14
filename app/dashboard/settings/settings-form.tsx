"use client";

// Settings → Rates and business rules (Nov 14 review, SR1-SR8).
// Before: one card with seven boxes under two small grey labels, units only in the labels, and a "Save rates" popup that
// always listed the three current gold prices (never what was being changed) and said the values also apply to
// renewals (they don't: a renewal keeps the loan's own rate).
// Now: two cards like the Reports pages (Gold pricing, Loan terms & charges), the unit inside each box, how liquidated
// damages are charged worked out from the typed values, and a review popup with only the changed values, old → new.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ActionForm, SubmitButton, useFieldError } from "@/components/form";
import { Card, SectionTitle, cx } from "@/components/ui";
import { formatDateTime, formatPeso } from "@/lib/format";
import { changedRates, damagesExample, formatRate, toNumber, type RateKey, type RateValues } from "@/lib/settings/rate-changes";
import { updateBusinessRules } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

export function SettingsForm({ settings, updatedByName }: { settings: Tables<"system_settings">; updatedByName: string | null }) {
  // what is saved now (from the database) and what is typed in the boxes
  const saved: RateValues = {
    price_24k: settings.price_24k,
    price_21k: settings.price_21k,
    price_18k: settings.price_18k,
    interest_rate_percent: settings.interest_rate_percent,
    ltv_percent: settings.ltv_percent,
    grace_period_days: settings.grace_period_days,
    liquidated_damages_percent: settings.liquidated_damages_percent,
  };
  const [typed, setTyped] = useState<RateValues>(saved);
  const changes = changedRates(saved, typed);
  const n = changes.length;

  const onType = (key: RateKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTyped((t) => ({ ...t, [key]: value }));
  };

  // SR3: the liquidated damages rule with the typed values (falls back to the saved ones while a box is empty)
  const grace = toNumber(typed.grace_period_days) ?? toNumber(saved.grace_period_days) ?? 0;
  const ldTyped = toNumber(typed.liquidated_damages_percent);
  const ld = ldTyped ?? toNumber(saved.liquidated_damages_percent) ?? 0;
  const example = damagesExample(ld);
  const ldOff = ldTyped === 0;

  return (
    <ActionForm action={updateBusinessRules} successMessage="Changes saved. New appraisals and new loans use these values." className="space-y-4">
      {/* SR6: the time the page was opened with, so a save can't silently undo another Admin's newer save */}
      <input type="hidden" name="expected_updated_at" value={settings.updated_at} />

      {/* SR1: Gold pricing */}
      <Card>
        <SectionTitle description="Item value = weight in grams × the price for its karat. Items below 18K are not accepted.">Gold pricing</SectionTitle>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          {(["24k", "21k", "18k"] as const).map((k) => (
            <RateField
              key={k}
              name={`price_${k}`}
              label={
                <>
                  {k.toUpperCase()} <span className="font-normal text-slate-500">price per gram</span>
                </>
              }
              prefix="₱"
              suffix="/ g"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              defaultValue={Number(settings[`price_${k}`]).toFixed(2)} // SR1: always 2 decimals, like money
              onChange={onType(`price_${k}`)}
              // SR8: the typed price read back with thousands separators (₱3,550.00), so a slip like 35500 stands out.
              // The box itself stays a plain number box: commas inside it would break typing and the arrow keys.
              hint={toNumber(typed[`price_${k}`]) !== null ? `${formatRate("peso", typed[`price_${k}`])} per gram` : undefined}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-600">Saved appraisals keep the price they were worked out with.</p>
      </Card>

      {/* SR2: Loan terms & charges */}
      <Card>
        <SectionTitle description="Copied onto each new loan when it is made. Existing loans keep their own values, also when renewed.">
          Loan terms &amp; charges
        </SectionTitle>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <RateField
            name="interest_rate_percent"
            label="Interest rate"
            srUnit="percent"
            suffix="%"
            step="0.01"
            min="0"
            inputMode="decimal"
            defaultValue={settings.interest_rate_percent}
            onChange={onType("interest_rate_percent")}
            hint="Per 30 days, of the principal."
          />
          <RateField
            name="ltv_percent"
            label="Loan-to-value"
            srUnit="percent"
            suffix="%"
            step="0.01"
            min="0.01"
            max="100"
            inputMode="decimal"
            defaultValue={settings.ltv_percent}
            onChange={onType("ltv_percent")}
            hint="Most a loan can be, as a share of the item's value. Saved appraisals keep theirs."
          />
          <RateField
            name="grace_period_days"
            label="Grace period"
            srUnit="days"
            suffix="days"
            step="1"
            min="0"
            inputMode="numeric"
            defaultValue={settings.grace_period_days}
            onChange={onType("grace_period_days")}
            hint="After the due date, to pay or renew before the loan defaults."
          />
          <RateField
            name="liquidated_damages_percent"
            label="Liquidated damages"
            srUnit="percent"
            suffix="%"
            step="0.01"
            min="0"
            max="100"
            inputMode="decimal"
            defaultValue={settings.liquidated_damages_percent}
            onChange={onType("liquidated_damages_percent")}
            hint="Per 30 days, of the unpaid principal. 0% = none on new loans."
          />
        </div>

        {/* SR3: how liquidated damages are charged, with the typed grace days and % (the rule from 0073) */}
        <div className="mt-4 rounded-md border border-navy-100 bg-navy-50/60 px-4 py-3 text-sm text-slate-700" aria-live="polite">
          <p className="font-semibold text-navy-900">How liquidated damages are charged</p>
          {ldOff ? (
            <p className="mt-1">At 0%, new loans are not charged liquidated damages. Existing loans keep the % they were made with.</p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                They start the day after the grace period ends (due date + {grace} {grace === 1 ? "day" : "days"}). Before that, only interest is charged.
              </li>
              <li>
                Every 30 days adds {fmtPct(ld)} of the unpaid principal. Part of 30 days counts as a full 30 days.
                {example !== null && <> Example: {formatPeso(10000)} unpaid → {formatPeso(example)} for each 30 days.</>}
              </li>
              <li>A payment pays liquidated damages first, then interest, then principal.</li>
            </ul>
          )}
        </div>
      </Card>

      {/* SR4: save row. Only the changed values go into the review popup */}
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-xs text-slate-600">
          <p aria-live="polite" className={cx("text-sm font-medium", n ? "text-amber-800" : "text-slate-600")}>
            {n ? `${n} ${n === 1 ? "change" : "changes"} not saved yet` : "No changes yet"}
          </p>
          {/* SR7: who saved last, and where every change is recorded (the audit trigger on system_settings) */}
          <p>
            Last updated {formatDateTime(settings.updated_at)}
            {updatedByName ? ` by ${updatedByName}` : ""} ·{" "}
            <Link href="/dashboard/reports?tab=audit&table=system_settings" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900">
              See change history
            </Link>
          </p>
        </div>
        <SubmitButton
          pendingLabel="Saving"
          disabled={n === 0}
          className="sm:shrink-0"
          confirm={{
            title: n === 1 ? "Save this change?" : `Save these ${n} changes?`,
            // SR5: what the change does and doesn't affect (checked in the database: loans copy the rate, grace days and
            // liquidated damages % when made; renewals use the loan's own rate; appraisals copy the gold price and LTV)
            message:
              "New appraisals and new loans use the new values from now on. Existing loans keep the interest rate, grace period and liquidated damages they were made with, also when renewed." +
              (ldOff ? " At 0%, new loans are not charged liquidated damages." : ""),
            confirmLabel: "Save changes",
            tone: "primary",
            details: changes,
          }}
        >
          Review changes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

const fmtPct = (n: number) => `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n)}%`;

// One number box with its unit inside (₱ in front, % or days behind). The unit is also in the label for screen readers.
function RateField({
  name,
  label,
  srUnit,
  prefix,
  suffix,
  hint,
  ...input
}: {
  name: string;
  label: ReactNode;
  srUnit?: string;
  prefix?: string;
  suffix?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {srUnit && <span className="sr-only"> ({srUnit})</span>}
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      </label>
      <div className="relative mt-1">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500" aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          name={name}
          type="number"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...input}
          className={cx(
            "block w-full rounded-md border bg-white py-2 text-sm tabular-nums text-slate-900 focus:outline-none focus:ring-2",
            // no up/down arrows inside the box (they would sit on top of the unit); the arrow keys still change the value
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            prefix ? "pl-7" : "pl-3",
            suffix ? (suffix.length > 2 ? "pr-14" : "pr-8") : "pr-3",
            error ? "border-red-500 focus:border-red-600 focus:ring-red-500/20" : "border-slate-300 focus:border-navy-500 focus:ring-navy-500/20",
          )}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500" aria-hidden="true">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
