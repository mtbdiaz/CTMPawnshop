// Link = Next.js's clickable link (C7: the name opens the profile; C11: phone cards)
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, manilaToday } from "@/lib/format";
import { loadCustomerScores } from "@/lib/customers/history";
import { ScoreBadge } from "@/components/score-badge";
import {
  Badge,
  Card,
  CreatePanel,
  EmptyState,
  PageHeader,
  Pagination,
  SearchBar,
  SortTH,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ActionsCell,
  ViewButton,
  pageParam,
  cx, // joins class names, and can add some only when a condition is true
} from "@/components/ui";
import { createCustomer } from "./actions";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Customers" };

const PAGE_SIZE = 25;
const SORTS: Record<string, string> = { name: "full_name", registered: "created_at" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string; new?: string }>;
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const params = await searchParams;
  const q = params.q?.trim();
  const page = pageParam(params.page);
  const sort = SORTS[params.sort ?? ""] ? params.sort! : "registered";
  const dir = params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  const canRegister = hasRole(user.profile.role, ["operator"]);

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, full_name, contact_number, id_type, id_number, aml_status, is_blacklisted, created_at", { count: "exact" })
    .is("archived_at", null)
    .order(SORTS[sort], { ascending: dir === "asc" })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`full_name.ilike.%${safe}%,contact_number.ilike.%${safe}%,id_number.ilike.%${safe}%`);
  }
  const { data: customers, count, error } = await query;
  if (error) throw error;
  const scores = await loadCustomerScores(supabase, (customers ?? []).map((c) => c.id), manilaToday());

  const listParams = { q, sort: params.sort, dir: params.dir };

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Look up a customer to see their profile, loans and payment history."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers" }]}
      />

      {canRegister && (
        <CreatePanel
          title="Register new customer"
          description="An AML identity check runs automatically on registration."
          defaultOpen={params.new === "1"}
        >
          <CustomerForm action={createCustomer} />
        </CreatePanel>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <SearchBar action="/dashboard/customers" defaultValue={q} placeholder="Search name, phone or ID number" />
          {q && (
            <p className="text-sm text-slate-500">
              {count ?? 0} result{count === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
            </p>
          )}
        </div>
        {customers && customers.length > 0 ? (
          <>
            {/* C11: PHONE ONLY (sm:hidden). One card per customer instead of a wide table,
                so the score and flags (Blacklisted, History warning) are visible without swiping. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {customers.map((c) => {
                const score = scores.get(c.id); // this customer's score and warnings
                return (
                  <li key={c.id}>
                    {/* the whole card opens the profile; blacklisted = light red background AND the word "Blacklisted" */}
                    <Link href={`/dashboard/customers/${c.id}`} className={cx("block px-4 py-3 hover:bg-slate-50", c.is_blacklisted && "bg-red-50/70")}>
                      {/* line 1: name on the left, score on the right */}
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-medium text-slate-900">{c.full_name}</span>
                        <ScoreBadge score={score?.score ?? null} tier={score?.tier ?? null} />
                      </span>
                      {/* line 2: phone and ID (break-all = a very long number wraps instead of widening the page) */}
                      <span className="mt-0.5 block break-all text-sm text-slate-600">
                        {c.contact_number} · {c.id_type} <span className="font-mono text-xs">{c.id_number}</span>
                      </span>
                      {/* line 3: flags, only if there are any */}
                      {(c.is_blacklisted || score?.hasWarnings || c.aml_status === "flagged") && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {c.is_blacklisted && <Badge tone="danger">Blacklisted</Badge>}
                          {score?.hasWarnings && <Badge tone="warning">History warning</Badge>}
                          {c.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* COMPUTERS (hidden sm:block): the full table */}
            <div className="hidden sm:block">
            <Table minWidth="880px">
              <THead>
                <SortTH label="Name" column="name" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
                <TH>Contact</TH>
                <TH>ID on file</TH>
                <TH>AML check</TH>
                <TH>Score</TH>
                <TH>Flags</TH>
                <SortTH label="Registered" column="registered" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {customers.map((c) => (
                  <TR key={c.id} highlight={c.is_blacklisted ? "danger" : undefined}>
                    <TD className="font-medium">
                      {/* C7: the name is also a link to the profile, so it can always be opened */}
                      <Link href={`/dashboard/customers/${c.id}`} className="hover:text-navy-700 hover:underline">
                        {c.full_name}
                      </Link>
                    </TD>
                    {/* C7: max-w + break-all = a very long phone number wraps inside its column
                        instead of stretching the table and pushing the View button off screen */}
                    <TD className="max-w-[11rem] break-all text-slate-600">{c.contact_number}</TD>
                    {/* min-w = wide enough for normal IDs (no break), max-w + break-all = only very long IDs wrap */}
                    <TD className="min-w-[8.5rem] max-w-[10rem] text-slate-600">              
                              <span className="block text-xs text-slate-500">{c.id_type}</span>
                      <span className="break-all font-mono text-xs">{c.id_number}</span>
                    </TD>
                    <TD>
                      <StatusBadge status={c.aml_status} label={c.aml_status === "flagged" ? "Flagged" : "Clear"} />
                    </TD>
                    <TD>
                      <ScoreBadge score={scores.get(c.id)?.score ?? null} tier={scores.get(c.id)?.tier ?? null} />
                    </TD>
                    <TD>
                      {/* flex-wrap so two badges stack neatly instead of overflowing */}
                      <span className="flex flex-wrap gap-1.5">
                        {c.is_blacklisted && <Badge tone="danger">Blacklisted</Badge>}
                        {scores.get(c.id)?.hasWarnings && <Badge tone="warning">History warning</Badge>}
                      </span>
                    </TD>
                    {/* C7: whitespace-nowrap keeps the date on one line ("Oct 9, 2026") */}
                    <TD className="whitespace-nowrap text-slate-600">{formatDate(c.created_at)}</TD>
                    <ActionsCell>
                      <ViewButton href={`/dashboard/customers/${c.id}`}>View customer</ViewButton>
                    </ActionsCell>
                  </TR>
                ))}
              </TBody>
            </Table>
            {/* end of the computer-only table */}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/customers" params={listParams} />
          </>
        ) : (
          <EmptyState
            icon="users"
            title={q ? "No customers match your search" : "No customers yet"}
            description={
              q
                ? "Check the spelling, or search by phone or ID number instead."
                : canRegister
                  ? "Register the first customer using the form above."
                  : "An Operator or Admin registers customers before their first appraisal."
            }
          />
        )}
      </Card>
    </div>
  );
}