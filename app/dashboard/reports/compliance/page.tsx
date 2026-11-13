import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { customerNo } from "@/lib/ref-numbers";
import { FLAG_STATUS, type FlagRow } from "@/lib/compliance/flags"; // the Suspicious activity page's status words
import { ReportHeader } from "@/components/report-header";
import { Badge, Card, EmptyState, SectionTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata = { title: "Compliance / AML report" };

type Flag = { id: string; status: FlagRow["status"]; reason: string; created_at: string; resolved_at: string | null; resolution_notes: string | null; customers: { full_name: string; customer_no: number } | null };

// RP7 (Nov 12): Compliance / AML (Admin only; since migration 0063 the database also lets only Admins read flags).
// Before: no C-numbers, the flag status used generic badge words, and "Last updated" on a blacklisted customer
// looked like the blacklist date (it is the last change to the customer record).
// Now: C-numbers, the Suspicious activity words (Open / Investigating / Dismissed / Blacklisted) with counts,
// when each flag was decided, and a link to Suspicious activity, where decisions are made. Read only.
export default async function ComplianceReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [amlRes, blacklistRes, flagsRes] = await Promise.all([
    // RP12: { count: "exact" } also asks for the real number of matching records (see the check below)
    supabase.from("customers").select("id, full_name, customer_no, aml_status, aml_checked_at, aml_notes", { count: "exact" }).eq("aml_status", "flagged").is("archived_at", null).order("full_name"),
    supabase.from("customers").select("id, full_name, customer_no, blacklist_reason, updated_at", { count: "exact" }).eq("is_blacklisted", true).is("archived_at", null).order("full_name"),
    supabase
      .from("suspicious_activity_flags")
      .select("id, status, reason, created_at, resolved_at, resolution_notes, customers(full_name, customer_no)", { count: "exact" })
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
  ]);
  for (const res of [amlRes, blacklistRes, flagsRes]) if (res.error) throw res.error;
  const flagged = amlRes.data ?? [];
  const blacklisted = blacklistRes.data ?? [];
  const flags = (flagsRes.data ?? []) as unknown as Flag[];
  // RP12 (Nov 13): each list is read in one request, and the database sends at most 1,000 rows per request (the
  // same limit that cut Trends to 1,000 loans). Today the lists are small (18 flags, 4 blacklisted), but if one ever
  // grows past the limit the page now says so instead of quietly showing part of it as the whole list.
  const cut = [
    { label: "AML-flagged customers", shown: flagged.length, total: amlRes.count ?? flagged.length },
    { label: "blacklisted customers", shown: blacklisted.length, total: blacklistRes.count ?? blacklisted.length },
    { label: "suspicious-activity flags", shown: flags.length, total: flagsRes.count ?? flags.length },
  ].filter((c) => c.total > c.shown);
  const byStatus = (Object.keys(FLAG_STATUS) as FlagRow["status"][]).map((s) => [s, flags.filter((f) => f.status === s).length] as const);

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Compliance / AML"
        description="AML identity checks, blacklisted customers and suspicious-activity flags, for regulator or auditor review. Read only: decisions are made on Suspicious activity."
        subtitle={`${flagged.length} AML-flagged · ${blacklisted.length} blacklisted · ${flags.length} suspicious-activity flags (${byStatus.map(([s, n]) => `${n} ${FLAG_STATUS[s].label.toLowerCase()}`).join(", ")})`}
      />

      {cut.length > 0 && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Incomplete: this report shows {cut.map((c) => `${c.shown} of ${c.total} ${c.label}`).join(", ")}. The counts above cover only the rows shown.
        </p>
      )}

      <section className="break-inside-avoid">
        <SectionTitle>Customers flagged by the AML check</SectionTitle>
        <Card padded={false}>
          {flagged.length ? (
            <Table>
              <THead>
                <TH>Customer</TH>
                <TH>Notes</TH>
                <TH>Checked</TH>
              </THead>
              <TBody>
                {flagged.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">
                      {c.full_name}
                      <span className="block font-mono text-xs font-normal text-slate-500">{customerNo(c.customer_no)}</span>
                    </TD>
                    <TD>{c.aml_notes}</TD>
                    <TD className="whitespace-nowrap">{formatDate(c.aml_checked_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No AML flags" />
          )}
        </Card>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle description="New loans and new appraisals are refused for these customers; loans they already have don't change.">Blacklisted customers</SectionTitle>
        <Card padded={false}>
          {blacklisted.length ? (
            <Table>
              <THead>
                <TH>Customer</TH>
                <TH>Reason</TH>
                <TH>Record last changed</TH>
              </THead>
              <TBody>
                {blacklisted.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">
                      {c.full_name}
                      <span className="block font-mono text-xs font-normal text-slate-500">{customerNo(c.customer_no)}</span>
                    </TD>
                    <TD>{c.blacklist_reason}</TD>
                    {/* the last change to the customer's record (not necessarily the day of the blacklist; the audit trail has that) */}
                    <TD className="whitespace-nowrap">{formatDate(c.updated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No blacklisted customers" />
          )}
        </Card>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle
          description={
            <>
              Newest first.{" "}
              <Link href="/dashboard/compliance" className="font-medium text-navy-700 hover:underline print:hidden">
                Review flags on Suspicious activity
              </Link>
            </>
          }
        >
          Suspicious-activity flags
        </SectionTitle>
        <Card padded={false}>
          {flags.length ? (
            <Table minWidth="720px">
              <THead>
                <TH>Raised</TH>
                <TH>Customer</TH>
                <TH>Reason (as recorded)</TH>
                <TH>Status</TH>
                <TH>Decided</TH>
              </THead>
              <TBody>
                {flags.map((f) => {
                  const st = FLAG_STATUS[f.status];
                  return (
                    <TR key={f.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(f.created_at)}</TD>
                      <TD>
                        {f.customers?.full_name ?? ""}
                        <span className="block font-mono text-xs text-slate-500">{customerNo(f.customers?.customer_no)}</span>
                      </TD>
                      <TD>{f.reason}</TD>
                      <TD>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap">{f.status === "dismissed" || f.status === "blacklisted" ? (f.resolved_at ? formatDate(f.resolved_at) : "Not recorded") : "Not decided"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No suspicious-activity flags" />
          )}
        </Card>
      </section>
    </div>
  );
}
