import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { ViewTabs } from "@/components/view-tabs"; // D2: the shared tab row (no "Viewing" here: each tab is a whole section, not a list)
import { AuditTrail } from "./audit-trail";

export const metadata = { title: "Reports" };

// RP2 (Nov 12): the six reports as cards, each with its category, so they read as a small directory.
// Before: a three-column table where most of the width was empty and nothing told the reports apart.
const REPORTS: { href: string; label: string; category: string; icon: IconName; description: string }[] = [
  { href: "/dashboard/reports/outstanding", label: "Outstanding loans", category: "Loans", icon: "ticket", description: "Every open loan: what is still owed, when it is due and where it stands." },
  { href: "/dashboard/reports/overdue", label: "Overdue loans", category: "Loans", icon: "bell", description: "Loans past their due date that still owe money: in grace, past grace or defaulted." },
  { href: "/dashboard/reports/inventory-aging", label: "Inventory aging", category: "Inventory", icon: "vault", description: "Items still in the shop and how long each has been held." },
  { href: "/dashboard/reports/financial-summary", label: "Financial summary", category: "Finance", icon: "cash", description: "Cash in, cash out and the change for a date range, by entry type." },
  { href: "/dashboard/reports/compliance", label: "Compliance / AML", category: "Compliance", icon: "shield", description: "AML-flagged and blacklisted customers, and suspicious-activity flags." },
  { href: "/dashboard/reports/analytics", label: "Trends & analytics", category: "Analytics", icon: "chart", description: "Redemption and forfeiture rates, average loan and monthly loan volume." },
];

// Item 13: Reports and the Audit Trail share one page. Both are Admin-only
// (requireRole here; RLS on audit_log allows only Admins to read it).
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const tab = params.tab === "audit" ? "audit" : "reports";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Read-only reports built from the loan, inventory, cash and compliance records. Each one shows when its data was read."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports" }]}
      />
      {/* D2: the same tab row as every other page (navy line under the open tab) */}
      <ViewTabs
        label="Reports sections"
        current={tab}
        tabs={[
          { label: "Reports", value: "reports", href: "/dashboard/reports" },
          { label: "Audit trail", value: "audit", href: "/dashboard/reports?tab=audit" },
        ]}
      />
      {tab === "audit" ? (
        <AuditTrail params={params} />
      ) : (
        // RP2: the columns follow the space the cards really get (a container query), not the screen width,
        // because the sidebar takes part of the screen: 1 column when narrow, 2 from 36rem, 3 from 56rem
        <div className="@container">
          <ul className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
            {REPORTS.map((r) => (
              <li key={r.href}>
                {/* the whole card is one link, so it can be clicked anywhere and reached with Tab */}
                <Link
                  href={r.href}
                  className="group flex h-full flex-col rounded-md border border-slate-200 bg-white p-4 transition-colors hover:border-navy-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-50 text-navy-700" aria-hidden="true">
                      <Icon name={r.icon} className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{r.category}</span>
                  </span>
                  <span className="mt-3 block font-semibold text-slate-900">{r.label}</span>
                  <span className="mt-1 block flex-1 text-sm text-slate-600">{r.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-navy-700 group-hover:underline">
                    View report <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
