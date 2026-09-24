import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Reports" };

const REPORTS = [
  { href: "/dashboard/reports/outstanding", label: "Outstanding loans", icon: "ticket", description: "Every open loan — who owes what, and when it's due." },
  { href: "/dashboard/reports/overdue", label: "Overdue loans", icon: "alert", description: "Loans past maturity, for collections follow-up or forfeiture." },
  { href: "/dashboard/reports/inventory-aging", label: "Inventory aging", icon: "vault", description: "How long each item has been held in the vault." },
  { href: "/dashboard/reports/financial-summary", label: "Financial summary", icon: "cash", description: "Cash in, cash out and net position for any date range." },
  { href: "/dashboard/reports/compliance", label: "Compliance / AML", icon: "shield", description: "AML flags, blacklist actions and suspicious-activity reviews." },
  { href: "/dashboard/reports/analytics", label: "Trends & analytics", icon: "chart", description: "Redemption and forfeiture rates, average loan size, monthly volume." },
] as const;

export default async function ReportsPage() {
  await requireRole(["admin"]);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Every report can be printed, or saved as a PDF from the print dialog."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports" }]}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-navy-300 hover:bg-navy-50/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-gold-300">
              <Icon name={r.icon} className="h-5 w-5" />
            </span>
            <span>
              <span className="flex items-center gap-1 font-semibold text-slate-900 group-hover:text-navy-800">
                {r.label}
                <Icon name="chevron-right" className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-1 block text-sm text-slate-600">{r.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
