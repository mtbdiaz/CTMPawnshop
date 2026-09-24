import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole, ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition } from "@/lib/finance/ledger";
import { daysUntilDue } from "@/lib/compliance/reminders";
import { formatDate, formatPeso, manilaDayStart, manilaToday } from "@/lib/format";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatCard,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableLink,
} from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Dashboard" };

type LoanRow = {
  id: string;
  ticket_number: string;
  maturity_date: string;
  principal_balance: number;
  interest_owed: number;
  status: string;
  customers: { full_name: string } | null;
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const role = user.profile.role;
  const supabase = await createClient();

  const canSeeCash = hasRole(role, ["operator", "cashier"]);

  const [{ data: openLoans }, { data: todayCash }, { count: pendingFlags }, { count: openSuspicious }, { count: customerCount }] =
    await Promise.all([
      supabase
        .from("loans")
        .select("id, ticket_number, maturity_date, principal_balance, interest_owed, status, customers(full_name)")
        .in("status", ["active", "extended"])
        .order("maturity_date"),
      canSeeCash
        ? supabase.from("cash_flow_entries").select("amount, direction").gte("created_at", manilaDayStart())
        : Promise.resolve({ data: [] as { amount: number; direction: "in" | "out" }[] }),
      supabase
        .from("appraisal_items")
        .select("id", { count: "exact", head: true })
        .eq("is_counterfeit_risk", true)
        .eq("counterfeit_resolution", "pending"),
      role === "admin"
        ? supabase.from("suspicious_activity_flags").select("id", { count: "exact", head: true }).eq("status", "open")
        : Promise.resolve({ count: 0 }),
      supabase.from("customers").select("id", { count: "exact", head: true }),
    ]);

  const loans = (openLoans ?? []) as unknown as LoanRow[];
  const now = new Date();
  const today = manilaToday(now);
  const overdue = loans.filter((l) => daysUntilDue(l.maturity_date, today) < 0);
  const dueSoon = loans.filter((l) => {
    const days = daysUntilDue(l.maturity_date, today);
    return days >= 0 && days <= 7;
  });
  const outstanding = loans.reduce((sum, l) => sum + Number(l.principal_balance) + Number(l.interest_owed), 0);
  const cash = computeCashPosition(todayCash ?? []);
  const attention = [...overdue, ...dueSoon].slice(0, 8);

  const firstName = user.profile.full_name.split(" ")[0];
  const hour = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Manila" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const actions: { href: string; label: string; icon: Parameters<typeof Icon>[0]["name"]; primary?: boolean }[] = [];
  if (hasRole(role, ["cashier"])) actions.push({ href: "/dashboard/loans?new=1", label: "New pawn loan", icon: "ticket", primary: true });
  if (hasRole(role, ["appraiser"])) actions.push({ href: "/dashboard/appraisals?new=1", label: "New appraisal", icon: "scale", primary: role === "appraiser" });
  if (hasRole(role, ["operator"])) actions.push({ href: "/dashboard/customers?new=1", label: "Register customer", icon: "users", primary: role === "operator" });
  actions.push({ href: "/dashboard/customers", label: "Find a customer", icon: "search" });
  if (hasRole(role, ["cashier"])) actions.push({ href: "/dashboard/compliance/reminders", label: "Due-date reminders", icon: "bell" });
  if (hasRole(role, ["operator"])) actions.push({ href: "/dashboard/inventory/audit", label: "Run vault audit", icon: "clipboard" });
  if (role === "admin") actions.push({ href: "/dashboard/reports", label: "View reports", icon: "chart" });

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`Signed in as ${ROLE_LABELS[role]}. Here's what needs attention today.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open loans"
          value={loans.length}
          hint={`${formatPeso(outstanding)} outstanding`}
          href="/dashboard/loans?status=open"
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length ? "danger" : "default"}
          hint={overdue.length ? "Past maturity — follow up" : "Nothing overdue"}
          href={role === "admin" ? "/dashboard/reports/overdue" : "/dashboard/loans?status=overdue"}
        />
        <StatCard
          label="Due in 7 days"
          value={dueSoon.length}
          tone={dueSoon.length ? "warning" : "default"}
          hint="Maturing soon"
          href={hasRole(role, ["cashier"]) ? "/dashboard/compliance/reminders" : "/dashboard/loans?status=open"}
        />
        {canSeeCash ? (
          <StatCard
            label="Net cash today"
            value={formatPeso(cash.net)}
            tone="gold"
            hint={`${formatPeso(cash.totalIn)} in · ${formatPeso(cash.totalOut)} out`}
            href="/dashboard/finance"
          />
        ) : (
          <StatCard label="Customers on file" value={customerCount ?? 0} hint="Registered customers" href="/dashboard/customers" />
        )}
      </div>

      {((pendingFlags ?? 0) > 0 || (openSuspicious ?? 0) > 0) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(pendingFlags ?? 0) > 0 && (
            <Link
              href="/dashboard/appraisals?risk=pending"
              className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 hover:border-red-400"
            >
              <Icon name="alert" className="h-5 w-5 text-red-700" />
              <span>
                <strong>{pendingFlags}</strong> appraisal{pendingFlags === 1 ? "" : "s"} flagged as possible counterfeit
                {role === "admin" ? " — awaiting your review." : " — waiting on an Admin."}
              </span>
            </Link>
          )}
          {(openSuspicious ?? 0) > 0 && (
            <Link
              href="/dashboard/compliance"
              className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 hover:border-amber-400"
            >
              <Icon name="shield" className="h-5 w-5 text-amber-700" />
              <span>
                <strong>{openSuspicious}</strong> suspicious-activity flag{openSuspicious === 1 ? "" : "s"} open for review.
              </span>
            </Link>
          )}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SectionTitle>Quick actions</SectionTitle>
          <div className="grid gap-2">
            {actions.map((a) => (
              <ButtonLink key={a.href} href={a.href} variant={a.primary ? "primary" : "secondary"}>
                <span className="flex w-full items-center gap-2">
                  <Icon name={a.icon} className="h-4 w-4" />
                  {a.label}
                  <Icon name="chevron-right" className="ml-auto h-4 w-4 opacity-60" />
                </span>
              </ButtonLink>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionTitle description="Overdue loans first, then loans maturing within 7 days.">Needs attention</SectionTitle>
          <Card padded={false}>
            {attention.length === 0 ? (
              <EmptyState icon="check" title="All caught up" description="No loans are overdue or maturing in the next 7 days." />
            ) : (
              <Table minWidth="560px">
                <THead>
                  <TH>Ticket</TH>
                  <TH>Customer</TH>
                  <TH>Due</TH>
                  <TH align="right">Owed</TH>
                  <TH>Status</TH>
                </THead>
                <TBody>
                  {attention.map((loan) => {
                    const late = -daysUntilDue(loan.maturity_date, today);
                    return (
                      <TR key={loan.id} highlight={late > 0 ? "danger" : undefined}>
                        <TD mono>
                          <TableLink href={`/dashboard/loans/${loan.id}`}>{loan.ticket_number}</TableLink>
                        </TD>
                        <TD>{loan.customers?.full_name ?? "—"}</TD>
                        <TD>
                          {formatDate(loan.maturity_date)}
                          {late > 0 && <span className="ml-1 text-xs font-semibold text-red-700">({late}d late)</span>}
                        </TD>
                        <TD align="right">{formatPeso(Number(loan.principal_balance) + Number(loan.interest_owed))}</TD>
                        <TD>
                          <StatusBadge status={late > 0 ? "defaulted" : loan.status} label={late > 0 ? "Overdue" : undefined} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
