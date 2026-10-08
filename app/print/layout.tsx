import { requireRole } from "@/lib/auth/require-role";
import { thermalCss } from "@/lib/print";
import { PrintToolbar } from "./print-toolbar";

// Thermal tickets and receipts render outside the dashboard shell so nothing
// but the slip reaches the printer.
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);
  return (
    <>
      <style>{thermalCss()}</style>
      <PrintToolbar />
      <main className="thermal">{children}</main>
    </>
  );
}
