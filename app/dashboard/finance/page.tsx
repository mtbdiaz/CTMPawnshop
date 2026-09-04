import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition, computeRunningBalances } from "@/lib/finance/ledger";
import { CashEntryForm } from "./cash-entry-form";

export default async function FinancePage() {
  await requireRole(["operator", "cashier", "admin"]);

  const supabase = await createClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ data: todayEntries }, { data: allEntries }] = await Promise.all([
    supabase
      .from("cash_flow_entries")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .order("created_at"),
    supabase.from("cash_flow_entries").select("*").order("created_at").limit(200),
  ]);

  const todayPosition = computeCashPosition(todayEntries ?? []);
  const ledger = allEntries ?? [];
  const balances = computeRunningBalances(ledger);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Cash Flow &amp; Financial Ledger</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every loan, payment, and forfeiture event logs a cash flow entry automatically. Record
        non-loan expenses/revenue below.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <StatCard label="Cash in today" value={todayPosition.totalIn} />
        <StatCard label="Cash out today" value={todayPosition.totalOut} />
        <StatCard label="Net position today" value={todayPosition.net} highlight />
      </div>

      <div className="mt-6">
        <CashEntryForm />
      </div>

      <h2 className="mt-8 text-sm font-medium text-slate-900">Ledger</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Date</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Description</th>
            <th className="pb-2 pr-4">In</th>
            <th className="pb-2 pr-4">Out</th>
            <th className="pb-2 pr-4">Balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.length ? (
            ledger.map((entry, i) => (
              <tr key={entry.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">{new Date(entry.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4 capitalize">{entry.entry_type.replace("_", " ")}</td>
                <td className="py-2 pr-4">{entry.description}</td>
                <td className="py-2 pr-4">
                  {entry.direction === "in" ? `₱${entry.amount.toLocaleString()}` : ""}
                </td>
                <td className="py-2 pr-4">
                  {entry.direction === "out" ? `₱${entry.amount.toLocaleString()}` : ""}
                </td>
                <td className="py-2 pr-4 font-medium">₱{balances[i].toLocaleString()}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="py-4 text-sm text-slate-500">
                No cash flow entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={highlight ? "text-xl font-semibold text-slate-900" : "text-lg text-slate-700"}>
        ₱{value.toLocaleString()}
      </div>
    </div>
  );
}
