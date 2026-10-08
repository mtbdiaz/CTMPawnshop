import { redirect } from "next/navigation";

// Item 13: User Accounts now lives under Settings.
export default function UsersPage() {
  redirect("/dashboard/settings?tab=users");
}
