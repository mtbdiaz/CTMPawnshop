import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { formatDateTime, formatPeso } from "@/lib/format";
import { Alert, ButtonLink, Card, DetailGrid, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { ArchiveForm } from "@/components/archive-controls";
import { ResolveForm } from "./resolve-form";
import { EditAppraisalForm } from "./edit-form";

export default async function AppraisalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const role = user.profile.role;
  const { id } = await params;

  const supabase = await createClient();
  const { data: appraisal } = await supabase.from("appraisal_items").select("*").eq("id", id).maybeSingle();
  if (!appraisal) notFound();

  const [photoUrls, { data: loan }] = await Promise.all([
    Promise.all(
      appraisal.photo_paths.map(async (path) => {
        const { data } = await supabase.storage.from("item-photos").createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      }),
    ),
    supabase.from("loans").select("id, ticket_number, status").eq("appraisal_item_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const available = appraisal.status === "available" && !appraisal.archived_at;
  const flaggedPending = appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution === "pending";
  const loanable = available && !(appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution !== "cleared");
  const title = `${categoryLabel(appraisal.category, appraisal.category_other)}, ${appraisal.karat}K, ${appraisal.weight_grams} g`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            <StatusBadge status={appraisal.archived_at ? "neutral" : appraisal.status} label={appraisal.archived_at ? "Archived" : appraisal.status === "available" ? "Available" : "Pawned"} />
          </span>
        }
        description={`Appraised ${formatDateTime(appraisal.created_at)}`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Appraisals", href: "/dashboard/appraisals" }, { label: title }]}
        actions={
          <>
            {loan && <ButtonLink href={`/dashboard/loans/${loan.id}`}>View loan {loan.ticket_number}</ButtonLink>}
            {loanable && hasRole(role, ["cashier"]) && (
              <ButtonLink href={`/dashboard/loans/new?item=${appraisal.id}`} variant="primary">
                Create loan
              </ButtonLink>
            )}
          </>
        }
      />

      {appraisal.is_counterfeit_risk && (
        <Alert
          tone={appraisal.counterfeit_resolution === "cleared" ? "success" : "danger"}
          title={
            flaggedPending
              ? "Flagged for counterfeit review"
              : appraisal.counterfeit_resolution === "cleared"
                ? "Counterfeit flag cleared by an Admin"
                : "Counterfeit risk confirmed. No loan may be issued against this item."
          }
        >
          {flaggedPending && (role === "admin" ? "Inspect the item and photos, then clear or confirm the flag." : "Waiting on an Admin to review.")}
          {role === "admin" && flaggedPending && <ResolveForm appraisalId={appraisal.id} />}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <SectionTitle>Valuation</SectionTitle>
            <DetailGrid
              items={[
                { label: "Value", value: formatPeso(appraisal.computed_value), emphasize: true },
                { label: "Maximum loan", value: formatPeso(appraisal.suggested_loan_max), emphasize: true },
                { label: "Category", value: categoryLabel(appraisal.category, appraisal.category_other) },
                { label: "Karat", value: `${appraisal.karat}K` },
                { label: "Weight", value: `${appraisal.weight_grams} g` },
                { label: "Price used", value: `${formatPeso(appraisal.gold_price_used)} per gram` },
                { label: "LTV used", value: `${appraisal.ltv_percent_used}%` },
                { label: "Notes", value: appraisal.condition_notes || "" },
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">Value = weight × price per gram for the karat. Maximum loan = value × LTV.</p>
          </Card>

          {available && hasRole(role, ["appraiser"]) && (
            <Card>
              <SectionTitle description="Allowed until the item is pawned. Saving recalculates at today's prices.">Edit appraisal</SectionTitle>
              <EditAppraisalForm
                id={appraisal.id}
                category={appraisal.category}
                categoryOther={appraisal.category_other}
                karat={appraisal.karat}
                weight={Number(appraisal.weight_grams)}
                notes={appraisal.condition_notes}
              />
            </Card>
          )}
          {available && hasRole(role, ["appraiser"]) && (
            <Card>
              <ArchiveForm table="appraisal_items" id={appraisal.id} label="Appraisal" />
            </Card>
          )}
        </div>

        <Card>
          <SectionTitle>Photos</SectionTitle>
          {photoUrls.filter(Boolean).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {photoUrls.filter(Boolean).map((url) => (
                <a key={url} href={url!} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url!} alt={`Photo of ${title}`} className="aspect-square w-full object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No photos.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
