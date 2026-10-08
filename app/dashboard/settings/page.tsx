import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Alert, Card, FilterTabs, PageHeader, SectionTitle, Table, TBody, TH, THead } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { listAccounts } from "../users/actions";
import { CreateAccountForm } from "../users/create-account-form";
import { AccountRow } from "../users/account-row";

export const metadata = { title: "Settings" };

// Item 13: System Settings and User Accounts merged into one page with tabs.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole(["admin"]);
  const tab = (await searchParams).tab === "users" ? "users" : "rates";

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]} />
      <FilterTabs
        current={tab}
        tabs={[
          { label: "Rates and business rules", value: "rates", href: "/dashboard/settings" },
          { label: "Users", value: "users", href: "/dashboard/settings?tab=users" },
        ]}
      />
      {tab === "rates" ? <RatesTab /> : <UsersTab currentUserId={user.id} />}
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
  return (
    <Card>
      <SettingsForm settings={settings} />
      <p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">Last updated {formatDateTime(settings.updated_at)}</p>
    </Card>
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
