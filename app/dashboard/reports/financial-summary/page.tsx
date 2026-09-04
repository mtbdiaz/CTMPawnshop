import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { computeCashPosition } from "@/lib/finance/ledger";

export default async function FinancialSummaryReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(["admin"]);
  const { from, to } = await searchParams;

  const rangeStart = from ?? new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const rangeEnd = to ?? new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("cash_flow_entries")
    .select("*")
    .gte("created_at", `${rangeStart}T00:00:00`)
    .lte("created_at", `${rangeEnd}T23:59:59`);

  const position = computeCashPosition(entries ?? []);
  const revenue = (entries ?? []).filter((e) => e.entry_type === "revenue").reduce((s, e) => s + e.amount, 0);
  const expenses = (entries ?? []).filter((e) => e.entry_type === "expense").reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Financial Summary Report</h1>
        <PrintButton />
      </div>

      <form className="mt-4 flex items-end gap-3 print:hidden" action="/dashboard/reports/financial-summary">
        <div>
          <label htmlFor="from" className="block text-xs text-slate-600">From</label>
          <input id="from" name="from" type="date" defaultValue={rangeStart} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs text-slate-600">To</label>
          <input id="to" name="to" type="date" defaultValue={rangeEnd} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
          Apply
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">
        {rangeStart} to {rangeEnd}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 max-w-md">
        <SummaryCard label="Total cash in" value={position.totalIn} />
        <SummaryCard label="Total cash out" value={position.totalOut} />
        <SummaryCard label="Non-loan revenue" value={revenue} />
        <SummaryCard label="Non-loan expenses" value={expenses} />
        <SummaryCard label="Net position" value={position.net} highlight />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={highlight ? "text-xl font-semibold" : "text-lg"}>₱{value.toLocaleString()}</div>
    </div>
  );
}
