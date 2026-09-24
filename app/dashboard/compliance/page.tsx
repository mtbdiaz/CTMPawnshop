import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState, FilterTabs, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { FlagRow } from "./flag-row";

export const metadata = { title: "Suspicious activity" };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["admin"]);
  const view = (await searchParams).view === "resolved" ? "resolved" : "open";

  const supabase = await createClient();
  let query = supabase.from("suspicious_activity_flags").select("*, customers(full_name)").order("created_at", { ascending: false });
  query = view === "open" ? query.in("status", ["open", "investigating"]) : query.in("status", ["dismissed", "blacklisted"]).limit(100);
  const { data: flags, error } = await query;
  if (error) throw error;

  return (
    <div>
      <PageHeader
        title="Suspicious activity"
        description="Automatic AML pattern checks (placeholder rule: 3+ loans by one customer within 24 hours). Review each flag and decide."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Suspicious activity" }]}
      />

      <Card padded={false}>
        <div className="border-b border-slate-200 p-4">
          <FilterTabs
            current={view}
            tabs={[
              { label: "Needs review", value: "open", href: "/dashboard/compliance" },
              { label: "Resolved", value: "resolved", href: "/dashboard/compliance?view=resolved" },
            ]}
          />
        </div>
        {flags && flags.length > 0 ? (
          <Table>
            <THead>
              <TH>Customer</TH>
              <TH>Reason</TH>
              <TH>{view === "open" ? "Decision" : "Outcome"}</TH>
            </THead>
            <TBody>
              {flags.map((flag) => {
                const name = (flag as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—";
                return view === "open" ? (
                  <FlagRow
                    key={flag.id}
                    flagId={flag.id}
                    reason={flag.reason}
                    customerId={flag.customer_id}
                    customerName={name}
                    createdAt={flag.created_at}
                    status={flag.status}
                  />
                ) : (
                  <TR key={flag.id}>
                    <TD>{name}</TD>
                    <TD>{flag.reason}</TD>
                    <TD>
                      <StatusBadge status={flag.status} />
                      <span className="mt-0.5 block text-xs text-slate-500">{formatDateTime(flag.resolved_at)}</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon="shield"
            title={view === "open" ? "No flags need review" : "No resolved flags yet"}
            description={view === "open" ? "New flags appear automatically when a loan pattern looks unusual." : undefined}
          />
        )}
      </Card>
    </div>
  );
}
