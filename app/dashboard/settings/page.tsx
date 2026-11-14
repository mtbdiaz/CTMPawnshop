import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, PageHeader, SectionTitle, Table, TBody, TH, THead } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs"; // D2: the shared tab row (no "Viewing" here: each tab is a whole section, not a list)
import { SettingsForm } from "./settings-form";
import { listAccounts } from "../users/actions";
import { CreateAccountForm } from "../users/create-account-form";
import { AccountRow } from "../users/account-row";
import { AddVaultLocationForm, VaultLocationRow, type VaultRow } from "./vault-locations"; // #37

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
async function VaultsTab() {
  const supabase = await createClient();
  const [{ data: locations, error }, { data: stored }] = await Promise.all([
    supabase.from("vault_locations").select("id, name, is_active").order("name"),
    // items that are in the vault right now (pawned, renewed, or forfeited and waiting to be sold)
    supabase.from("inventory_items").select("vault_location").in("status", ["pawned", "extended", "forfeited", "queued_for_auction"]).limit(5000),
  ]);
  if (error) throw error;
  // count the stored items per location name (capitals don't matter)
  const counts = new Map<string, number>();
  for (const i of stored ?? []) {
    const key = (i.vault_location ?? "").trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: VaultRow[] = (locations ?? []).map((l) => ({ ...l, stored: counts.get(l.name.toLowerCase()) ?? 0 }));
  const on = rows.filter((r) => r.is_active).length;
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle description="New loans can only be stored in a location on this list.">Add a location</SectionTitle>
        <AddVaultLocationForm />
      </Card>
      <section>
        <SectionTitle description={`${on} switched on of ${rows.length}`}>Locations</SectionTitle>
        <Card padded={false}>
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
        </Card>
        <p className="mt-2 text-xs text-slate-500">
          A location can be switched off but not deleted or renamed, so older records always show a name that is still on this list.
        </p>
      </section>
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
