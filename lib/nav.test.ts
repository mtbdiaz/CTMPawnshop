import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { NAV_SECTIONS, navForRole, activeHref } from "./nav";

const items = NAV_SECTIONS.flatMap((s) => s.items);

function pageGuardRoles(href: string): string[] | null {
  const file = path.join(process.cwd(), "app", href, "page.tsx");
  expect(existsSync(file), `${href} has no page.tsx — dead nav link`).toBe(true);
  const match = readFileSync(file, "utf8").match(/requireRole\(\[([^\]]*)\]\)/);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((r) => r.trim().replace(/["']/g, ""))
    .filter((r) => r && r !== "admin")
    .sort();
}

describe("navigation matches page permissions", () => {
  for (const item of items) {
    it(`${item.href} is shown to exactly the roles its page allows`, () => {
      const guard = pageGuardRoles(item.href);
      // No requireRole() means any signed-in staff member (layout-level auth only).
      const expected = guard ?? ["appraiser", "cashier", "operator"];
      expect([...item.roles].sort()).toEqual(expected);
    });
  }
});

describe("navForRole", () => {
  it("gives Admin every item", () => {
    const count = navForRole("admin").flatMap((s) => s.items).length;
    expect(count).toBe(items.length);
  });

  it("hides admin-only screens from an Appraiser", () => {
    const hrefs = navForRole("appraiser").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/dashboard/finance");
    expect(hrefs).not.toContain("/dashboard/compliance");
    expect(hrefs).toContain("/dashboard/appraisals");
  });

  it("gives a Cashier the reminders screen they are allowed to use", () => {
    const hrefs = navForRole("cashier").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/dashboard/compliance/reminders");
    expect(hrefs).not.toContain("/dashboard/compliance/audit");
  });
});

describe("activeHref", () => {
  it("highlights the closest section for a detail page", () => {
    expect(activeHref("/dashboard/loans/abc-123")).toBe("/dashboard/loans");
    expect(activeHref("/dashboard/inventory/audit")).toBe("/dashboard/inventory/audit");
    expect(activeHref("/dashboard/reports/overdue")).toBe("/dashboard/reports");
  });

  it("only highlights Dashboard on the dashboard itself", () => {
    expect(activeHref("/dashboard")).toBe("/dashboard");
    expect(activeHref("/dashboard/customers")).toBe("/dashboard/customers");
  });
});
