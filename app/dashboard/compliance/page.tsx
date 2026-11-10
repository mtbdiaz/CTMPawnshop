import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { customerNo } from "@/lib/ref-numbers"; // C-0012
import { Card, EmptyState, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D2: the shared tab row and the row under it ("Viewing")
import type { Enums } from "@/lib/supabase/database.types"; // D2: the flag status names, for the counts
import { FlagRow } from "./flag-row";

export const metadata = { title: "Suspicious activity" };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["admin"]);
  const view = (await searchParams).view === "resolved" ? "resolved" : "open";

  const supabase = await createClient();
  let query = supabase.from("suspicious_activity_flags").select("*, customers(full_name, customer_no)").order("created_at", { ascending: false });
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

  // SA1: for each open flag, the loans that customer opened in the 24 hours up to the flag (what set it off),
  // so the Admin sees "3 loans in 24 hours · ₱19,500 total" without opening anything. One read for all flags.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const openFlags = view === "open" ? (flags ?? []).filter((f) => f.customer_id) : [];
  const customerIds = [...new Set(openFlags.map((f) => f.customer_id as string))];
  const earliest = openFlags.length ? new Date(Math.min(...openFlags.map((f) => new Date(f.created_at).getTime())) - DAY_MS).toISOString() : null;
  const { data: recentLoans } =
    customerIds.length && earliest
      ? await supabase.from("loans").select("customer_id, created_at, principal_amount").in("customer_id", customerIds).gte("created_at", earliest).limit(1000)
      : { data: [] };
  const summaryOf = (customerId: string | null, flaggedAt: string) => {
    if (!customerId) return null;
    const end = new Date(flaggedAt).getTime() + 60_000; // + 1 minute: the flag is saved in the same moment as the loan
    const mine = (recentLoans ?? []).filter((l) => {
      const t = new Date(l.created_at).getTime();
      return l.customer_id === customerId && t >= end - 60_000 - DAY_MS && t <= end;
    });
    if (!mine.length) return null;
    const total = mine.reduce((sum, l) => sum + Number(l.principal_amount), 0);
    return `${mine.length} loan${mine.length === 1 ? "" : "s"} in 24 hours · ${formatPeso(total)} total · ${formatDate(flaggedAt)}`;
  };

  // SA5: who resolved each flag (Resolved tab). Staff names the database lets an Admin read
  const resolverIds = view === "resolved" ? [...new Set((flags ?? []).map((f) => f.resolved_by).filter((x): x is string => Boolean(x)))] : [];
  const { data: resolvers } = resolverIds.length ? await supabase.from("profiles").select("id, full_name").in("id", resolverIds) : { data: [] };
  const resolverName = new Map((resolvers ?? []).map((p) => [p.id, p.full_name]));

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
                const who = (flag as unknown as { customers: { full_name: string; customer_no: number } | null }).customers;
                const name = who?.full_name ?? "";
                const number = who ? customerNo(who.customer_no) : "";
                return view === "open" ? (
                  <FlagRow
                    key={flag.id}
                    flagId={flag.id}
                    reason={flag.reason}
                    customerId={flag.customer_id}
                    customerName={name}
                    customerNumber={number}
                    summary={summaryOf(flag.customer_id, flag.created_at)}
                    createdAt={flag.created_at}
                    status={flag.status}
                  />
                ) : (
                  <TR key={flag.id}>
                    <TD>
                      {/* the name opens the profile, like on the other lists */}
                      {flag.customer_id ? (
                        <Link href={`/dashboard/customers/${flag.customer_id}`} className="rounded-sm font-medium underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      <span className="block font-mono text-xs text-slate-500">{number}</span>
                    </TD>
                    <TD>{flag.reason}</TD>
                    <TD>
                      <StatusBadge status={flag.status} />
                      {/* SA5: when, and who decided */}
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {formatDateTime(flag.resolved_at)}
                        {flag.resolved_by ? ` · ${resolverName.get(flag.resolved_by) ?? "staff"}` : ""}
                      </span>
                      {/* #14: the Admin's note, if one was written */}
                      {flag.resolution_notes && <span className="mt-0.5 block max-w-xs break-words text-xs italic text-slate-700">&ldquo;{flag.resolution_notes}&rdquo;</span>}
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
