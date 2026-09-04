import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";

const REPORTS = [
  { href: "/dashboard/reports/outstanding", label: "Outstanding Loans" },
  { href: "/dashboard/reports/overdue", label: "Overdue Loans" },
  { href: "/dashboard/reports/inventory-aging", label: "Inventory Aging" },
  { href: "/dashboard/reports/financial-summary", label: "Financial Summary" },
  { href: "/dashboard/reports/compliance", label: "Compliance / AML" },
  { href: "/dashboard/reports/analytics", label: "Trends & Analytics Dashboard" },
];

export default async function ReportsPage() {
  await requireRole(["admin"]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Reports &amp; Analytics</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every report below can be exported (via your browser&apos;s Print → Save as PDF) or
        printed directly.
      </p>
      <div className="mt-6 grid max-w-md grid-cols-1 gap-2">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 hover:bg-slate-50"
          >
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
