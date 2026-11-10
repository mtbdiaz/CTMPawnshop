import { appraisalNo, customerNo } from "@/lib/ref-numbers"; // #29: the short appraisal number (A-0045); #38: C-0012
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalState } from "@/lib/appraisal/status"; // A1: one rule for the badge and loan eligibility
import { formatDateTime, formatPeso } from "@/lib/format";
import { Alert, ButtonLink, Card, DetailGrid, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ArchiveForm } from "@/components/archive-controls";
import { ResolveForm } from "./resolve-form";
import { EditAppraisalForm } from "./edit-form";
import { SetCustomerForm } from "./set-customer-form"; // #38

// C8: the browser tab shows the item (e.g. "Ring, 18K, 1.899 g · Appraisal"), never customer details
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["appraiser", "cashier", "operator", "admin"]); // only signed-in staff
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("appraisal_items").select("category, category_other, karat, weight_grams").eq("id", id).maybeSingle();
  return { title: data ? `${categoryLabel(data.category, data.category_other)}, ${data.karat}K, ${data.weight_grams} g · Appraisal` : "Appraisal" }; // the layout adds " · CTM PawnTrack"
}

export default async function AppraisalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const role = user.profile.role;
  const { id } = await params;

  const supabase = await createClient();
  const { data: appraisal } = await supabase.from("appraisal_items").select("*").eq("id", id).maybeSingle();
  if (!appraisal) notFound();

  // C6: the staff on this record. Staff can only read names the database allows
  // (all for Admin; their own for others until Matt #11), so we never guess a name.
  const staffIds = [appraisal.appraised_by, appraisal.counterfeit_resolved_by].filter((x): x is string => Boolean(x));
  const [photoUrls, { data: loan }, { data: staff }, { data: settings }, { data: owner }] = await Promise.all([
    Promise.all(
      appraisal.photo_paths.map(async (path) => {
        const { data } = await supabase.storage.from("item-photos").createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      }),
    ),
    supabase.from("loans").select("id, ticket_number, status").eq("appraisal_item_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    staffIds.length ? supabase.from("profiles").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    supabase.from("system_settings").select("price_24k, price_21k, price_18k, ltv_percent").eq("id", 1).maybeSingle(), // for the Edit preview
    // #38: the customer the item belongs to (older appraisals may have none)
    appraisal.customer_id
      ? supabase.from("customers").select("id, full_name, customer_no").eq("id", appraisal.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const ownerText = owner ? `${owner.full_name} (${customerNo(owner.customer_no)})` : null; // "Ana Cruz (C-0012)"
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));
  const who = (staffId: string | null) => (!staffId ? "Not recorded" : staffId === user.id ? `${names.get(staffId) ?? "You"} (you)` : (names.get(staffId) ?? "Other staff")); // same words as the list

  const available = appraisal.status === "available" && !appraisal.archived_at;
  const state = appraisalState(appraisal); // A1: Available / Counterfeit review / Confirmed risk / Pawned / Archived
  const flaggedPending = state.key === "review";
  const loanable = state.loanable; // same rule the database uses in create_pawn_loan
  const editable = available && state.key !== "confirmed"; // A4: a confirmed risk can only be archived
  const cleared = appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution === "cleared";
  const canEdit = editable && hasRole(role, ["appraiser"]) && Boolean(settings);
  const canArchive = available && hasRole(role, ["appraiser"]);
  const canSetCustomer = available && hasRole(role, ["appraiser"]); // #38: Appraiser or Admin, only while not pawned (the database checks too)
  const title = `${categoryLabel(appraisal.category, appraisal.category_other)}, ${appraisal.karat}K, ${appraisal.weight_grams} g`;
  const photos = photoUrls.filter((u): u is string => Boolean(u));

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            {/* A1: the real state, never a green "Available" on a flagged item */}
            <StatusBadge status={state.badge} label={state.label} />
          </span>
        }
        // #29: the short number first, so staff can read it out or write it on the item's tag
        description={`${appraisalNo(appraisal.appraisal_no)} · Appraised ${formatDateTime(appraisal.created_at)} by ${who(appraisal.appraised_by)}`}
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
          tone={cleared ? "success" : "danger"}
          title={
            flaggedPending
              ? "Flagged for counterfeit review. No loan until an Admin clears it."
              : cleared
                ? "Counterfeit flag cleared by an Admin"
                : "Counterfeit risk confirmed. No loan may be issued against this item."
          }
        >
          {flaggedPending && (role === "admin" ? "Inspect the item and photos, then clear or confirm the flag." : "Waiting on an Admin to review.")}
          {/* #13: when it went into review (it can be later than the appraisal, e.g. after a karat change) */}
          {flaggedPending && appraisal.counterfeit_flagged_at && <span className="block text-xs">Flagged {formatDateTime(appraisal.counterfeit_flagged_at)}.</span>}
          {/* C6: who decided and when (only once someone has) */}
          {!flaggedPending && (
            <>
              Reviewed by {who(appraisal.counterfeit_resolved_by)}
              {appraisal.counterfeit_resolved_at ? `, ${formatDateTime(appraisal.counterfeit_resolved_at)}` : ""}.
              {/* #28: the reason the Admin wrote (older decisions have none) */}
              {appraisal.counterfeit_resolution_notes && <span className="mt-1 block break-words italic">Reason: &ldquo;{appraisal.counterfeit_resolution_notes}&rdquo;</span>}
            </>
          )}
          {role === "admin" && flaggedPending && <ResolveForm appraisalId={appraisal.id} updatedAt={appraisal.updated_at} />}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <SectionTitle>Valuation</SectionTitle>
            <DetailGrid
              items={[
                { label: "Appraised value", value: formatPeso(appraisal.computed_value), emphasize: true },
                { label: "Maximum loan", value: formatPeso(appraisal.suggested_loan_max), emphasize: true },
                { label: "Category", value: categoryLabel(appraisal.category, appraisal.category_other) },
                { label: "Karat", value: `${appraisal.karat}K` },
                { label: "Weight", value: `${appraisal.weight_grams} g` },
                { label: "Price used", value: `${formatPeso(appraisal.gold_price_used)} per gram` },
                { label: "LTV used", value: `${appraisal.ltv_percent_used}%` },
                { label: "Customer", value: ownerText ?? "Not recorded" }, // #38: who brought the item in (older appraisals have none)
                { label: "Appraised by", value: who(appraisal.appraised_by) }, // C6
                { label: "Notes", value: appraisal.condition_notes?.trim() || "None" }, // C9: never a blank
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">Value = weight × price per gram for the karat. Maximum loan = value × LTV.</p>
          </Card>

          {/* C7: Edit and Archive are closed by default (like Admin actions on the customer profile), so the page stays short */}
          {(canEdit || canArchive || canSetCustomer) && (
            <section>
              <SectionTitle description="Only while the item is not pawned. Changes are saved in the audit trail.">Appraisal actions</SectionTitle>
              <Card padded={false} className="divide-y divide-slate-200">
                {canEdit && settings && (
                  <details className="group">
                    {/* the clickable row; the arrow turns when open */}
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-medium text-slate-900">Edit appraisal</span>
                        <span className="block text-sm text-slate-500">Fix the item details. Only a karat or weight change re-prices it at today&apos;s price.</span>
                      </span>
                      <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-slate-100 px-5 py-4">
                      <EditAppraisalForm
                        id={appraisal.id}
                        category={appraisal.category}
                        categoryOther={appraisal.category_other}
                        karat={appraisal.karat}
                        weight={Number(appraisal.weight_grams)}
                        notes={appraisal.condition_notes}
                        updatedAt={appraisal.updated_at}
                        prices={settings}
                        ltvPercent={Number(settings.ltv_percent)}
                        currentValue={Number(appraisal.computed_value)}
                        currentMax={Number(appraisal.suggested_loan_max)}
                        cleared={cleared}
                        canChangeMaterial={role === "admin"} // A3: on a cleared item only an Admin may (the server checks too)
                      />
                    </div>
                  </details>
                )}
                {canSetCustomer && (
                  <details className="group">
                    {/* #38: put or correct who the item belongs to */}
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-medium text-slate-900">{ownerText ? "Change customer" : "Set customer"}</span>
                        <span className="block text-sm text-slate-500">
                          {ownerText ? "If the item was saved under the wrong person. Only that customer can pawn it." : "This older appraisal has no customer yet, so anyone can pawn it."}
                        </span>
                      </span>
                      <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-slate-100 px-5 py-4">
                      <SetCustomerForm appraisalId={appraisal.id} updatedAt={appraisal.updated_at} currentName={ownerText} />
                    </div>
                  </details>
                )}
                {canArchive && (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-medium text-slate-900">Archive appraisal</span>
                        <span className="block text-sm text-slate-500">
                          {/* A4: for a confirmed risk this is the only action left */}
                          {state.key === "confirmed" ? "This item can't be pawned. Archive it once the item is returned." : "Hide it from the list, e.g. entered twice by mistake. Nothing is deleted."}
                        </span>
                      </span>
                      <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-slate-100 px-5 py-4">
                      <ArchiveForm table="appraisal_items" id={appraisal.id} label="Appraisal" />
                    </div>
                  </details>
                )}
              </Card>
            </section>
          )}
        </div>

        <Card>
          <SectionTitle>Photos</SectionTitle>
          {photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {photos.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1} of ${title}`} className="aspect-square w-full object-cover" />
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
