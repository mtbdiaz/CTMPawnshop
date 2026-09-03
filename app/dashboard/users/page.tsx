import { requireRole } from "@/lib/auth/require-role";
import { listAccounts } from "./actions";
import { CreateAccountForm } from "./create-account-form";
import { AccountRow } from "./account-row";

export default async function UsersPage() {
  await requireRole(["admin"]);
  const accounts = await listAccounts();

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">User Accounts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create, edit, and deactivate staff accounts. Deactivated accounts immediately lose
        system access.
      </p>

      <div className="mt-6">
        <CreateAccountForm />
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Account</th>
            <th className="pb-2 pr-4">Password</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
