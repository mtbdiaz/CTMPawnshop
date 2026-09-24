import { requireRole } from "@/lib/auth/require-role";
import { Card, PageHeader, SectionTitle, Table, TBody, TH, THead } from "@/components/ui";
import { listAccounts } from "./actions";
import { CreateAccountForm } from "./create-account-form";
import { AccountRow } from "./account-row";

export const metadata = { title: "User accounts" };

export default async function UsersPage() {
  const user = await requireRole(["admin"]);
  const accounts = await listAccounts();
  const active = accounts.filter((a) => a.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="User accounts"
        description="Create staff accounts, change roles, reset passwords, and deactivate accounts when someone leaves. Deactivated accounts can't sign in."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "User accounts" }]}
      />

      <Card>
        <SectionTitle>Add a staff member</SectionTitle>
        <CreateAccountForm />
      </Card>

      <section>
        <SectionTitle description={`${active} active of ${accounts.length}`}>Staff</SectionTitle>
        <Card padded={false}>
          <Table minWidth="820px">
            <THead>
              <TH>Name, email &amp; role</TH>
              <TH>Status</TH>
              <TH>Access</TH>
            </THead>
            <TBody>
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} isSelf={account.id === user.id} />
              ))}
            </TBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
