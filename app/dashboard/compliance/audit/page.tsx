import { redirect } from "next/navigation";

// Item 13: the Audit Trail is now a tab on Reports (Admin only).
export default async function AuditTrailRedirect({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; page?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams({ tab: "audit" });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  redirect(`/dashboard/reports?${qs.toString()}`);
}
