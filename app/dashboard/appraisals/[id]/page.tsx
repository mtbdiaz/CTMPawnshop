import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPeso } from "@/lib/format";
import { Alert, ButtonLink, Card, DetailGrid, PageHeader, SectionTitle, StatusBadge, TableLink } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ResolveForm } from "./resolve-form";

export default async function AppraisalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const role = user.profile.role;
  const { id } = await params;

  const supabase = await createClient();
  const { data: appraisal } = await supabase
    .from("appraisal_items")
    .select("*, customers(id, full_name, is_blacklisted)")
    .eq("id", id)
    .maybeSingle();
  if (!appraisal) notFound();

  const customer = (appraisal as unknown as { customers: { id: string; full_name: string; is_blacklisted: boolean } | null }).customers;

  const [photoUrls, { data: loan }] = await Promise.all([
    Promise.all(
      appraisal.photo_paths.map(async (path) => {
        const { data } = await supabase.storage.from("item-photos").createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      }),
    ),
    supabase
      .from("loans")
      .select("id, ticket_number, status")
      .eq("appraisal_item_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const flaggedPending = appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution === "pending";
  const loanable =
    !loan?.status?.match(/^(active|extended)$/) &&
    !(appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution !== "cleared") &&
    !customer?.is_blacklisted;
  const title = `${appraisal.weight_grams}g · ${appraisal.karat}k gold`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={
          <>
            Appraised {formatDateTime(appraisal.created_at)} for{" "}
            {customer ? <TableLink href={`/dashboard/customers/${customer.id}`}>{customer.full_name}</TableLink> : "—"}
          </>
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Appraisals", href: "/dashboard/appraisals" },
          { label: title },
        ]}
        actions={
          loanable &&
          hasRole(role, ["cashier"]) && (
            <ButtonLink href={`/dashboard/loans?new=1&item=${appraisal.id}`} variant="primary">
              <Icon name="ticket" className="h-4 w-4" /> Create loan
            </ButtonLink>
          )
        }
      />

      {appraisal.is_counterfeit_risk && (
        <Alert
          tone={appraisal.counterfeit_resolution === "cleared" ? "success" : "danger"}
          title={
            flaggedPending
              ? `Counterfeit risk — tested purity ${appraisal.purity_percent}% is outside the expected range for ${appraisal.karat}k`
              : appraisal.counterfeit_resolution === "cleared"
                ? "Counterfeit flag cleared by an Admin — item may be used for a loan"
                : "Counterfeit risk confirmed — no loan may be issued against this item"
          }
        >
          {flaggedPending && (role === "admin" ? "Review the item and photos, then clear or confirm the flag." : "Waiting on an Admin to review.")}
          {role === "admin" && flaggedPending && <ResolveForm appraisalId={appraisal.id} />}
        </Alert>
      )}
      {customer?.is_blacklisted && <Alert tone="danger" title="This customer is blacklisted — no loan can be issued." />}
      {loan && (
        <Alert tone="info">
          Loan <TableLink href={`/dashboard/loans/${loan.id}`}>{loan.ticket_number}</TableLink> was issued against this item
          ({loan.status}).
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle>Valuation</SectionTitle>
          <DetailGrid
            items={[
              { label: "Appraised value", value: formatPeso(appraisal.computed_value), emphasize: true },
              {
                label: "Suggested loan range",
                value: `${formatPeso(appraisal.suggested_loan_min)} – ${formatPeso(appraisal.suggested_loan_max)}`,
                emphasize: true,
              },
              {
                label: "Counterfeit check",
                value: appraisal.is_counterfeit_risk ? (
                  <StatusBadge status={appraisal.counterfeit_resolution ?? "pending"} />
                ) : (
                  <StatusBadge status="cleared" label="Passed" />
                ),
              },
              { label: "Weight", value: `${appraisal.weight_grams} g` },
              { label: "Claimed karat", value: `${appraisal.karat}k` },
              { label: "Tested purity", value: `${appraisal.purity_percent}%` },
              { label: "Gold price used", value: `${formatPeso(appraisal.gold_price_used)}/g` },
              { label: "LTV used", value: `${appraisal.ltv_percent_used}%` },
              { label: "Condition notes", value: appraisal.condition_notes || "—" },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">
            Valuation uses a placeholder formula pending confirmation by CTM Pawnshop (weight × purity × gold price, loan =
            value × LTV).
          </p>
        </Card>

        <Card>
          <SectionTitle>Photos</SectionTitle>
          {photoUrls.filter(Boolean).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {photoUrls.filter(Boolean).map((url) => (
                <a key={url} href={url!} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url!} alt={`Photo of ${title}`} className="aspect-square w-full object-cover transition-transform hover:scale-105" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No photos could be loaded.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
