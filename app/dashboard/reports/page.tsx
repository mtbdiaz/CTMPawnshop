import { requireRole } from "@/lib/auth/require-role";
import { Card, FilterTabs, PageHeader, Table, TBody, TD, TH, THead, TR, ViewButton, ActionsCell } from "@/components/ui";
import { AuditTrail } from "./audit-trail";

export const metadata = { title: "Reports" };

const REPORTS = [
  { href: "/dashboard/reports/outstanding", label: "Outstanding loans", description: "Every open loan: who owes what and when it is due." },
  { href: "/dashboard/reports/overdue", label: "Overdue loans", description: "Loans past maturity, for collection or forfeiture." },
  { href: "/dashboard/reports/inventory-aging", label: "Inventory aging", description: "How long each item has been held in the vault." },
  { href: "/dashboard/reports/financial-summary", label: "Financial summary", description: "Cash in, cash out and net position for a date range." },
  { href: "/dashboard/reports/compliance", label: "Compliance / AML", description: "AML flags, blacklist actions and suspicious-activity reviews." },
  { href: "/dashboard/reports/analytics", label: "Trends", description: "Redemption and forfeiture rates, average loan, monthly volume." },
];

// Item 13: Reports and the Audit Trail share one page. Both are Admin-only
// (requireRole here; RLS on audit_log allows only Admins to read it).
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; table?: string; action?: string; page?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const tab = params.tab === "audit" ? "audit" : "reports";

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports" }]} />
      <FilterTabs
        current={tab}
        tabs={[
          { label: "Reports", value: "reports", href: "/dashboard/reports" },
          { label: "Audit trail", value: "audit", href: "/dashboard/reports?tab=audit" },
        ]}
      />
      {tab === "audit" ? (
        <AuditTrail params={params} />
      ) : (
        <Card padded={false}>
          <Table minWidth="560px">
            <THead>
              <TH>Report</TH>
              <TH>Shows</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {REPORTS.map((r) => (
                <TR key={r.href}>
                  <TD className="font-medium">{r.label}</TD>
                  <TD className="text-slate-600">{r.description}</TD>
                  <ActionsCell>
                    <ViewButton href={r.href}>Open report</ViewButton>
                  </ActionsCell>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
