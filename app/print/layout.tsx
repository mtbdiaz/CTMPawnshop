import { requireRole } from "@/lib/auth/require-role";
import { PrintToolbar } from "./print-toolbar";

// Printable documents render outside the dashboard shell so nothing but the
// document reaches the printer. Each group below sets its own paper size.
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);
  return (
    <>
      <PrintToolbar />
      {children}
    </>
  );
}
