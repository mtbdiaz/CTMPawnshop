import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, PageHeader, SectionTitle, Table, TBody, TH, THead } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs"; // D2: the shared tab row (no "Viewing" here: each tab is a whole section, not a list)
import { SettingsForm } from "./settings-form";
import { listAccounts } from "../users/actions";
import { CreateAccountForm } from "../users/create-account-form";
import { AccountRow } from "../users/account-row";
import Link from "next/link";
import { AddVaultLocationForm, OtherLocations, VaultLocationCard, VaultLocationRow, type OtherLocationRow, type VaultRow } from "./vault-locations"; // #37
import { countByLocation, inventoryTabFor, itemsLabel, locationKey, readItemsInShop } from "@/lib/settings/vault-locations"; // VL (Nov 15)

export const metadata = { title: "Settings" };

// Item 13: System Settings and User Accounts merged into one page with tabs.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole(["admin"]);
  const asked = (await searchParams).tab;
  const tab = asked === "users" || asked === "vaults" ? asked : "rates"; // anything else opens the first tab

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]} />
      {/* D2: the same tab row as every other page (navy line under the open tab) */}
      <ViewTabs
        label="Settings sections"
        current={tab}
        tabs={[
          { label: "Rates and business rules", value: "rates", href: "/dashboard/settings" },
          { label: "Vault locations", value: "vaults", href: "/dashboard/settings?tab=vaults" },
          { label: "Users", value: "users", href: "/dashboard/settings?tab=users" },
        ]}
      />
      {tab === "rates" ? <RatesTab /> : tab === "vaults" ? <VaultsTab /> : <UsersTab currentUserId={user.id} />}
    </div>
  );
}

async function RatesTab() {
  const supabase = await createClient();
  const { data: settings, error } = await supabase.from("system_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!settings) {
    return <Alert tone="danger" title="Settings row missing">Re-run the database migrations to restore it.</Alert>;
  }
  // SR7 (Nov 14): the name of the Admin who saved last, for the "Last updated ... by ..." line under the form
  const { data: by } = settings.updated_by
    ? await supabase.from("profiles").select("full_name").eq("id", settings.updated_by).maybeSingle()
    : { data: null };
  // Before: the form sat in one Card with "Last updated <time>" under it. Now the form has its own two cards (Gold
  // pricing, Loan terms & charges) and a save row with the last update, so there is no outer Card.
  return <SettingsForm settings={settings} updatedByName={by?.full_name ?? null} />;
}

// #37: the list of vault locations a new loan may use (migration 0038)
// VL (Nov 15, Phase 2): accurate counts (VL4), the other names items are still recorded under (VL3), phone cards
// (VL5), the item count in the Switch off popup (VL2) and where changes are recorded (VL6). Read only: opening this tab
// changes nothing.
async function VaultsTab() {
  const supabase = await createClient();
  const [{ data: locations, error }, items, { data: history }] = await Promise.all([
    supabase.from("vault_locations").select("id, name, is_active").order("name"),
    // VL4: every item in the shop (same rule as Inventory: pawned, renewed, forfeited, queued; not archived), read
    // 1,000 at a time. Before: one request, which the database cuts at 1,000 rows
    readItemsInShop(supabase),
    // VL6: how many changes to vault locations the audit trail has (Admins only, the same function as the Audit trail)
    supabase.rpc("audit_log_page", { p_table: "vault_locations", p_page: 1, p_size: 1 }),
  ]);
  if (error) throw error;
  const counts = countByLocation(items, (locations ?? []).map((l) => l.name));
  const rows: VaultRow[] = (locations ?? []).map((l) => ({ ...l, stored: counts.listed.get(locationKey(l.name)) ?? 0 }));
  const on = rows.filter((r) => r.is_active).length;
  const changes = Number((history as { total?: number } | null)?.total ?? 0);
  // VL3: each other name opens Inventory filtered to exactly that name, on the tab that shows its items
  const others: OtherLocationRow[] = counts.others.map((o) => ({
    name: o.name,
    count: o.count,
    href: `/dashboard/inventory?${new URLSearchParams({ status: inventoryTabFor(o.statuses), loc: o.name }).toString()}`,
  }));

  return (
    <div className="space-y-5">
      {/* VL: a short summary of what is in the shop and where (counted like the Inventory tabs) */}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary label="Locations switched on" value={`${on} of ${rows.length}`} hint="Offered for new loans" />
        <Summary label="Items in listed locations" value={counts.listedTotal.toLocaleString("en-PH")} hint={`of ${itemsLabel(counts.total)} in the shop`} />
        <Summary label="Items under other names" value={counts.otherTotal.toLocaleString("en-PH")} hint={counts.otherTotal ? "Older names, listed below" : "None"} warn={counts.otherTotal > 0} />
      </dl>

      <Card>
        <SectionTitle description="New loans can only be stored in a location on this list.">Add a location</SectionTitle>
        <AddVaultLocationForm />
      </Card>

      <section>
        <SectionTitle description={`${on} switched on of ${rows.length}`}>Locations</SectionTitle>
        <Card padded={false}>
          {/* tablets and computers: the table (same as before) */}
          <div className="hidden sm:block">
            <Table minWidth="560px">
              <THead>
                <TH>Name</TH>
                <TH>New loans</TH>
                <TH align="right">Items stored now</TH>
                <TH align="right">Change</TH>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <VaultLocationRow key={row.id} row={row} />
                ))}
              </TBody>
            </Table>
          </div>
          {/* VL5: phones: one compact card per location, everything visible without sideways scrolling */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((row) => (
              <VaultLocationCard key={row.id} row={row} />
            ))}
          </ul>
        </Card>
        <p className="mt-2 text-xs text-slate-500">
          A location can be switched off but not deleted or renamed, so older records always show a name that is still on this list. Items stored
          now = items in the shop (in vault, forfeited or queued for auction), the same as the Inventory tabs.
        </p>
      </section>

      {/* VL3: read only. Shown only when some items are still recorded under a name that isn't on the list */}
      {others.length > 0 && (
        <section>
          <SectionTitle
            description={`${itemsLabel(counts.otherTotal)} in the shop ${counts.otherTotal === 1 ? "is" : "are"} recorded under ${others.length === 1 ? "a location name" : "location names"} that ${others.length === 1 ? "isn't" : "aren't"} on the list above (typed before the list existed). Nothing was changed or merged. Keep them visible until their physical places are checked; items can't be moved to another location in the app yet.`}
          >
            Other recorded locations
          </SectionTitle>
          <Card padded={false}>
            <OtherLocations rows={others} total={counts.otherTotal} />
          </Card>
        </section>
      )}

      {/* VL6: where changes are recorded. The link only shows when there is something to see (no made-up history) */}
      <p className="text-xs text-slate-600">
        {changes > 0 ? (
          <>
            {`${changes.toLocaleString("en-PH")} ${changes === 1 ? "change" : "changes"} to vault locations recorded · `}
            <Link href="/dashboard/reports?tab=audit&table=vault_locations" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900">
              See change history
            </Link>
          </>
        ) : (
          "No changes to vault locations recorded yet. Adding a location or switching one on or off is recorded in the Audit trail, with who did it and when."
        )}
      </p>
    </div>
  );
}

// one small summary box (the same look as the report summaries)
function Summary({ label, value, hint, warn = false }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border bg-white px-4 py-3 ${warn ? "border-amber-200" : "border-slate-200"}`}>
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-navy-900">{value}</dd>
      <dd className="text-xs text-slate-500">{hint}</dd>
    </div>
  );
}

async function UsersTab({ currentUserId }: { currentUserId: string }) {
  const accounts = await listAccounts();
  const active = accounts.filter((a) => a.is_active).length;
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>Add a staff member</SectionTitle>
        <CreateAccountForm />
      </Card>
      <section>
        <SectionTitle description={`${active} active of ${accounts.length}`}>Staff</SectionTitle>
        <Card padded={false}>
          <Table minWidth="820px">
            <THead>
              <TH>Name, email and role</TH>
              <TH>Status</TH>
              <TH>Access</TH>
            </THead>
            <TBody>
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} isSelf={account.id === currentUserId} />
              ))}
            </TBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
