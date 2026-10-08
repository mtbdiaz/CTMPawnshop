import { describe, expect, it, vi } from "vitest";

// Item 13: old URLs redirect into the merged pages.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

describe("merged page redirects", () => {
  it("/dashboard/users goes to Settings > Users", async () => {
    const { default: UsersPage } = await import("@/app/dashboard/users/page");
    expect(() => UsersPage()).toThrow("REDIRECT:/dashboard/settings?tab=users");
  });

  it("/dashboard/compliance/audit goes to Reports > Audit trail and keeps filters", async () => {
    const { default: AuditRedirect } = await import("@/app/dashboard/compliance/audit/page");
    await expect(AuditRedirect({ searchParams: Promise.resolve({ table: "loans", page: "2" }) })).rejects.toThrow(
      "REDIRECT:/dashboard/reports?tab=audit&table=loans&page=2",
    );
  });

  it("old receipt URL goes to the thermal receipt", async () => {
    const { default: Receipt } = await import("@/app/dashboard/loans/[id]/receipt/[paymentId]/page");
    await expect(Receipt({ params: Promise.resolve({ id: "l1", paymentId: "p1" }) })).rejects.toThrow("REDIRECT:/print/receipt/p1");
  });
});
