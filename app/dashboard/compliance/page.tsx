import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D2: the shared tab row and the row under it ("Viewing")
import type { Enums } from "@/lib/supabase/database.types"; // D2: the flag status names, for the counts
import { FlagRow } from "./flag-row";

export const metadata = { title: "Suspicious activity" };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["admin"]);
  const view = (await searchParams).view === "resolved" ? "resolved" : "open";

  const supabase = await createClient();
  let query = supabase.from("suspicious_activity_flags").select("*, customers(full_name)").order("created_at", { ascending: false });
  query = view === "open" ? query.in("status", ["open", "investigating"]) : query.in("status", ["dismissed", "blacklisted"]).limit(100);
  // D2: how many flags are in each tab (read-only counts, same status groups as the list; head = only the number)
  const countIn = (statuses: Enums<"suspicious_flag_status">[]) =>
    supabase.from("suspicious_activity_flags").select("id", { count: "exact", head: true }).in("status", statuses);
  const [{ data: flags, error }, { count: nOpen }, { count: nResolved }] = await Promise.all([
    query, // the flags in the open tab
    countIn(["open", "investigating"]), // Needs review
    countIn(["dismissed", "blacklisted"]), // Resolved
  ]);
  if (error) throw error;

  return (
    <div>
      <PageHeader
        title="Suspicious activity"
        // B3: the list can hold flags with other reasons too (each row shows its own reason), so the 3-loan rule is
        // described as the one the system adds by itself, not as the only kind of flag
        description="Unusual customer activity, each with its reason. The system adds a flag by itself when a customer opens 3 or more loans within 24 hours (a placeholder rule until CTM confirms its AML rules). Review each flag and decide."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Suspicious activity" }]}
      />

      <Card padded={false}>
        {/* D2: the same tab row as Loans and Customers, now with counts. Amber dot on Needs review (an Admin has to decide) */}
        <ViewTabs
          label="Flag views"
          current={view}
          tabs={[
            { label: "Needs review", value: "open", href: "/dashboard/compliance", count: nOpen ?? 0, tone: "warning" },
            { label: "Resolved", value: "resolved", href: "/dashboard/compliance?view=resolved", count: nResolved ?? 0 },
          ]}
        />
        {/* D2: "Viewing: Needs review" on the right. Resolved shows only the newest 100, so it says so */}
        <ViewToolbar viewing={view === "open" ? "Needs review" : (nResolved ?? 0) > 100 ? "Resolved (newest 100)" : "Resolved"} />
        {flags && flags.length > 0 ? (
          <Table>
            <THead>
              <TH>Customer</TH>
              <TH>Reason</TH>
              <TH>{view === "open" ? "Decision" : "Outcome"}</TH>
            </THead>
            <TBody>
              {flags.map((flag) => {
                const name = (flag as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "";
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
