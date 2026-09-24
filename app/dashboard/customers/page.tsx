import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
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
  TableLink,
  pageParam,
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
    .order(SORTS[sort], { ascending: dir === "asc" })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`full_name.ilike.%${safe}%,contact_number.ilike.%${safe}%,id_number.ilike.%${safe}%`);
  }
  const { data: customers, count, error } = await query;
  if (error) throw error;

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
          <SearchBar action="/dashboard/customers" defaultValue={q} placeholder="Search name, phone or ID number…" />
          {q && (
            <p className="text-sm text-slate-500">
              {count ?? 0} result{count === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
            </p>
          )}
        </div>
        {customers && customers.length > 0 ? (
          <>
            <Table>
              <THead>
                <SortTH label="Name" column="name" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
                <TH>Contact</TH>
                <TH>ID on file</TH>
                <TH>AML check</TH>
                <TH>Flags</TH>
                <SortTH label="Registered" column="registered" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
              </THead>
              <TBody>
                {customers.map((c) => (
                  <TR key={c.id} highlight={c.is_blacklisted ? "danger" : undefined}>
                    <TD>
                      <TableLink href={`/dashboard/customers/${c.id}`}>{c.full_name}</TableLink>
                    </TD>
                    <TD className="text-slate-600">{c.contact_number}</TD>
                    <TD className="text-slate-600">
                      <span className="block text-xs text-slate-500">{c.id_type}</span>
                      <span className="font-mono text-xs">{c.id_number}</span>
                    </TD>
                    <TD>
                      <StatusBadge status={c.aml_status} label={c.aml_status === "flagged" ? "Flagged" : "Clear"} />
                    </TD>
                    <TD>{c.is_blacklisted ? <Badge tone="danger" icon>Blacklisted</Badge> : <span className="text-slate-400">—</span>}</TD>
                    <TD className="text-slate-600">{formatDate(c.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
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
