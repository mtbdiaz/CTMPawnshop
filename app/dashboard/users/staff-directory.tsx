import { Alert, Badge, Card, Pagination, pageParam, SectionTitle, Table, TBody, TD, TH, THead, TR, buttonClasses } from "@/components/ui";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { attentionOf, filterStaff, permissionsFor, staffCounts, staffFilters, STAFF_PAGE_SIZE, type StaffAccount } from "@/lib/staff/directory";
import { AddStaffButton, FinishButton, StaffActions } from "./staff-actions";

export type StaffDirectoryParams = { q?: string; role?: string; status?: string; page?: string };

// the same small box as the Settings page summaries
function RoleCount({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-navy-900">{value}</dd>
      <dd className="text-xs text-slate-500">{hint}</dd>
    </div>
  );
}

// Phase 2B (Nov 15): Settings → Users as a staff list. Before: an editable form in every row (name box, role list,
// Save, Reset password, a red Deactivate button) inside an 820px table that scrolled sideways on phones.
// Now: summary by role, search + role + status filters (kept in the address, so paging keeps them), 10 per page,
// a clean table on tablets and computers, one card per person on phones, and one Actions menu per person.
// The page loads the accounts (UsersTab in app/dashboard/settings/page.tsx) and passes them in, so this list can also be
// checked with made-up accounts (for example an unfinished deactivation) without touching real staff.
export function StaffDirectory({ accounts, currentUserId, params }: { accounts: StaffAccount[]; currentUserId: string; params: StaffDirectoryParams }) {
  const counts = staffCounts(accounts);
  const f = staffFilters(params);
  const shown = filterStaff(accounts, f);
  const pages = Math.max(1, Math.ceil(shown.length / STAFF_PAGE_SIZE));
  const page = Math.min(pageParam(params.page), pages);
  const rows = shown.slice((page - 1) * STAFF_PAGE_SIZE, page * STAFF_PAGE_SIZE);
  const needAttention = accounts.filter((a) => attentionOf(a));
  const filtered = f.q !== "" || f.role !== "all" || f.status !== "all";
  const roleBadge = (a: StaffAccount) => <Badge tone={a.role === "admin" ? "info" : "neutral"}>{ROLE_LABELS[a.role]}</Badge>;
  const statusBadge = (a: StaffAccount) => {
    const attention = attentionOf(a);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {a.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
        {attention && <Badge tone="warning">Needs attention</Badge>}
      </span>
    );
  };
  const you = (a: StaffAccount) => (a.id === currentUserId ? <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span> : null);

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle description={`${counts.active} active of ${counts.total} accounts`}>Staff accounts</SectionTitle>
          <AddStaffButton />
        </div>
        {/* active staff per role */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ALL_ROLES.map((r) => (
            <RoleCount key={r} label={`${ROLE_LABELS[r]}s`} value={String(counts.byRole[r])} hint="active" />
          ))}
        </dl>

        {/* U5: an unfinished deactivation or reactivation, shown only when there is one */}
        {needAttention.length > 0 && (
          <Alert tone="warning" title={`${needAttention.length === 1 ? "1 account needs" : `${needAttention.length} accounts need`} attention`}>
            <ul className="mt-1 space-y-2">
              {needAttention.map((a) => {
                const kind = attentionOf(a)!;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{a.full_name}</span>:{" "}
                      {kind === "finish-deactivation" ? "deactivated in PawnTrack, but their sign-in isn't blocked yet." : "reactivated in PawnTrack, but their sign-in is still blocked."}
                    </span>
                    <FinishButton account={a} kind={kind} />
                  </li>
                );
              })}
            </ul>
          </Alert>
        )}

        {/* search and filters: a normal form, so it works without JavaScript and the address keeps the choices */}
        <form action="/dashboard/settings" role="search" aria-label="Search staff" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="users" />
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
            <input type="search" name="q" defaultValue={f.q} placeholder="Name or email" maxLength={80} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Role</span>
            <select name="role" defaultValue={f.role} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20">
              <option value="all">All roles</option>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
            <select name="status" defaultValue={f.status} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button type="submit" className={buttonClasses("secondary")}>
            Apply
          </button>
          {filtered && (
            <a href="/dashboard/settings?tab=users" className="pb-2 text-sm font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900">
              Clear
            </a>
          )}
        </form>
        <p className="text-sm text-slate-600" aria-live="polite">
          {shown.length === 0
            ? "No staff match these filters."
            : filtered
              ? `${shown.length} of ${accounts.length} accounts match.`
              : `${accounts.length} accounts.`}
        </p>

        {rows.length > 0 && (
          <Card padded={false}>
            {/* tablets and computers */}
            <div className="hidden md:block">
              <Table minWidth="640px">
                <THead>
                  <TH>Name and email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {rows.map((a) => (
                    <TR key={a.id} highlight={attentionOf(a) ? "warning" : undefined}>
                      <TD>
                        <span className="font-medium text-slate-900">{a.full_name}</span>
                        {you(a)}
                        <span className="block break-all text-xs text-slate-500">{a.email ?? "-"}</span>
                      </TD>
                      <TD>{roleBadge(a)}</TD>
                      <TD>{statusBadge(a)}</TD>
                      <TD align="right">
                        <StaffActions account={a} perms={permissionsFor(a, currentUserId, accounts)} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* phones: one card per person */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((a) => (
                <li key={a.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${attentionOf(a) ? "bg-amber-50/60" : ""}`}>
                  <div className="min-w-0">
                    <p className="break-words font-medium text-slate-900">
                      {a.full_name}
                      {you(a)}
                    </p>
                    <p className="break-all text-xs text-slate-500">{a.email ?? "-"}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {roleBadge(a)}
                      {statusBadge(a)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <StaffActions account={a} perms={permissionsFor(a, currentUserId, accounts)} />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={STAFF_PAGE_SIZE} total={shown.length} basePath="/dashboard/settings" params={{ tab: "users", q: f.q || undefined, role: f.role === "all" ? undefined : f.role, status: f.status === "all" ? undefined : f.status }} />
          </Card>
        )}
      </section>
    </div>
  );
}
