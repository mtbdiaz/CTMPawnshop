import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, SectionTitle, StatusBadge, Table, TBody, TD, TH, THead, TR, TableLink } from "@/components/ui";

export const metadata = { title: "Compliance / AML report" };

export default async function ComplianceReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [amlRes, blacklistRes, flagsRes] = await Promise.all([
    supabase.from("customers").select("id, full_name, aml_status, aml_checked_at, aml_notes").eq("aml_status", "flagged").order("full_name"),
    supabase.from("customers").select("id, full_name, blacklist_reason, updated_at").eq("is_blacklisted", true).order("full_name"),
    supabase.from("suspicious_activity_flags").select("*, customers(id, full_name)").order("created_at", { ascending: false }),
  ]);
  for (const res of [amlRes, blacklistRes, flagsRes]) if (res.error) throw res.error;
  const flagged = amlRes.data ?? [];
  const blacklisted = blacklistRes.data ?? [];
  const flags = flagsRes.data ?? [];

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Compliance / AML"
        description="AML identity checks, blacklist actions and suspicious-activity reviews, compiled for regulator or auditor review."
        subtitle={`${flagged.length} AML-flagged · ${blacklisted.length} blacklisted · ${flags.length} suspicious-activity flags`}
      />

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
                    <TD>
                      <TableLink href={`/dashboard/customers/${c.id}`}>{c.full_name}</TableLink>
                    </TD>
                    <TD>{c.aml_notes}</TD>
                    <TD>{formatDate(c.aml_checked_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon="check" title="No AML flags" />
          )}
        </Card>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle>Blacklisted customers</SectionTitle>
        <Card padded={false}>
          {blacklisted.length ? (
            <Table>
              <THead>
                <TH>Customer</TH>
                <TH>Reason</TH>
                <TH>Last updated</TH>
              </THead>
              <TBody>
                {blacklisted.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <TableLink href={`/dashboard/customers/${c.id}`}>{c.full_name}</TableLink>
                    </TD>
                    <TD>{c.blacklist_reason}</TD>
                    <TD>{formatDate(c.updated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon="check" title="No blacklisted customers" />
          )}
        </Card>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle>Suspicious-activity flags</SectionTitle>
        <Card padded={false}>
          {flags.length ? (
            <Table>
              <THead>
                <TH>Raised</TH>
                <TH>Customer</TH>
                <TH>Reason</TH>
                <TH>Outcome</TH>
              </THead>
              <TBody>
                {flags.map((f) => {
                  const c = (f as unknown as { customers: { id: string; full_name: string } | null }).customers;
                  return (
                    <TR key={f.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(f.created_at)}</TD>
                      <TD>{c ? <TableLink href={`/dashboard/customers/${c.id}`}>{c.full_name}</TableLink> : "—"}</TD>
                      <TD>{f.reason}</TD>
                      <TD>
                        <StatusBadge status={f.status} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon="check" title="No suspicious-activity flags" />
          )}
        </Card>
      </section>
    </div>
  );
}
