"use client"; // runs in the browser: picking results, the live progress numbers, the popups

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation"; // reloads the list / opens another page without a full reload
import { Badge, buttonClasses, Card, cx, EmptyState, SearchBar } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // the same tab row as Loans and Inventory
import { NavSelect } from "@/components/nav-select"; // a dropdown that opens what you pick
import { PhotoGrid } from "@/components/photo-viewer"; // photos that open in a popup on the same page
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalNo } from "@/lib/ref-numbers"; // 45 -> "A-0045"
import { CUSTODY, type InventoryStatus } from "@/lib/inventory/custody"; // the words for where an item is now
import {
  AUDIT_PAGE_SIZES,
  AUDIT_REASONS,
  AUDIT_RESULTS,
  auditCoverage,
  auditProgress,
  auditResultProblem,
  followupLabel,
  moveCount,
  reasonLabel,
  resultLabel,
  scopeLabel,
  type AuditPage,
  type AuditResult,
  type AuditRow,
  type AuditView,
  type Followup,
} from "@/lib/inventory/audit";
import { auditItemPhotos, saveAuditResult, submitAuditSession } from "../../actions";
import { DiscardDraft } from "../discard-draft"; // DD1: the "Discard draft" popup

// AS1 (Nov 11): the audit checklist.
// - Every item starts as "Not checked". Nothing is ever pre-ticked.
// - Picking a result saves it in the database right away (one item at a time). The screen only shows a result
//   as picked AFTER the database said it was saved, so what you see is what is saved.
// - The numbers at the top are for the whole audit and move as you check items.

// Back / Forward can show an older copy of a page for a moment. This remembers that Back or Forward was pressed,
// so the checklist asks the server for the fresh results when it opens.
let cameBack = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (cameBack = true));

// the tabs, in order. count = which number of the audit the tab shows
const VIEWS: { value: AuditView; label: string }[] = [
  { value: "all", label: "All items" },
  { value: "not_checked", label: "Not checked" },
  { value: "found", label: "Found" },
  { value: "not_located", label: "Not located" },
  { value: "found_elsewhere", label: "Found elsewhere" },
  { value: "prior", label: "Prior discrepancies" },
  { value: "left", label: "Left the shop" },
];

// does a row (with the result it has NOW on the screen) still belong to the open tab?
function inView(view: AuditView, result: AuditResult, row: AuditRow) {
  if (view === "not_checked") return result === "not_checked" && row.in_custody;
  if (view === "found" || view === "found_elsewhere" || view === "not_located") return result === view;
  if (view === "left") return result === "not_checked" && !row.in_custody;
  return true; // All items and Prior discrepancies don't depend on today's result
}

// followups = the checks done after a submitted audit (empty while the audit is in progress)
export function AuditSession({ data, base, view, q, vault, followups, canDiscard, extra }: { data: AuditPage; base: string; view: AuditView; q: string; vault: string; followups: Followup[]; canDiscard: boolean; extra: { overlapReason: string | null; discardedAt: string | null; discardedBy: string | null; discardReason: string | null } }) {
  const router = useRouter();
  const toast = useToast();
  const { audit, rows, total, page, size } = data;
  const open = audit.status === "in_progress"; // false = submitted or discarded (read only)
  const discarded = (audit.status as string) === "discarded"; // a draft that was thrown away (kept for the record)

  const [counts, setCounts] = useState(data.counts); // the whole audit's numbers; they move as items are checked
  const [results, setResults] = useState<Record<string, AuditResult>>(() => Object.fromEntries(rows.map((r) => [r.id, r.result ?? "not_checked"]))); // each row's saved result
  const [savedAt, setSavedAt] = useState<string | null>(null); // the time of the last save, for "Saved 9:10 PM"

  // came here with Back or Forward: get the fresh results (see cameBack above)
  useEffect(() => {
    if (cameBack) {
      cameBack = false;
      router.refresh();
    }
  }, [router]);

  const progress = auditProgress(counts); // { checked, total, percent }
  // rows on this page that no longer belong to the open tab (e.g. marked Found while looking at "Not checked")
  const moved = rows.filter((r) => !inView(view, results[r.id], r)).length;

  // builds an address of this audit with the given filters (empty ones are left out)
  function href(next: { view?: string; q?: string; vault?: string; page?: number; size?: number }) {
    const p = { view, q, vault, page: 1, size, ...next };
    const qs = new URLSearchParams();
    if (p.view && p.view !== "all") qs.set("view", p.view);
    if (p.q) qs.set("q", p.q);
    if (p.vault) qs.set("vault", p.vault);
    if (p.size !== 10) qs.set("size", String(p.size));
    if (p.page > 1) qs.set("page", String(p.page));
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  }

  // one row was saved: move the numbers and remember the time
  function onSaved(row: AuditRow, from: AuditResult, to: AuditResult) {
    setResults((prev) => ({ ...prev, [row.id]: to }));
    setCounts((c) => {
      // an item that left the shop is counted under "left" while unchecked, not under "not_checked"
      const key = (r: AuditResult) => (r === "not_checked" && !row.in_custody ? "left" : r);
      const a = key(from);
      const b = key(to);
      if (a === b) return c;
      let next = { ...c, [a]: Math.max(0, c[a] - 1), [b]: c[b] + 1 };
      if (a !== "left" && b !== "left") next = { ...c, ...moveCount(c, from, to) }; // the tested helper for the usual case
      if (row.prior_open) next.prior_found_now = Math.max(0, next.prior_found_now + (to === "found" ? 1 : 0) - (from === "found" ? 1 : 0));
      else next.new_findings = Math.max(0, next.new_findings + (to === "not_located" || to === "found_elsewhere" ? 1 : 0) - (from === "not_located" || from === "found_elsewhere" ? 1 : 0));
      return next;
    });
    setSavedAt(new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }));
  }

  const countOf: Record<AuditView, number> = {
    all: counts.expected,
    not_checked: counts.not_checked,
    found: counts.found,
    not_located: counts.not_located,
    found_elsewhere: counts.found_elsewhere,
    prior: counts.prior,
    left: counts.left,
  };
  const tabs = VIEWS.filter((v) => v.value !== "left" || counts.left > 0 || view === "left").map((v) => ({
    value: v.value,
    label: v.label,
    href: href({ view: v.value }),
    count: countOf[v.value],
    tone: v.value === "prior" ? ("warning" as const) : v.value === "not_located" ? ("danger" as const) : undefined,
  }));
  const viewing = VIEWS.find((v) => v.value === view)?.label ?? "All items";
  const vaults = data.vaults.filter((v): v is { vault: string; n: number } => Boolean(v.vault)); // the locations inside this audit
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  return (
    <>
      {/* ---- 1. the audit and its progress (compact: one card, no big number tiles) ---- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {open ? <Badge tone="warning">In progress</Badge> : discarded ? <Badge tone="neutral">Discarded</Badge> : <Badge tone="success">Submitted</Badge>}
            {/* AV1: how much of this audit's own list was checked (the scope is in the title and the line below) */}
            {!open && !discarded && (audit.is_partial ? <Badge tone="warning">Partial</Badge> : <Badge tone="neutral">All listed items checked</Badge>)}
            <span>
              Started {formatDateTime(audit.started_at)}
              {audit.started_by ? ` by ${audit.started_by}` : ""}
              {!open && audit.submitted_at ? ` · submitted ${formatDateTime(audit.submitted_at)}${audit.submitted_by ? ` by ${audit.submitted_by}` : ""}` : ""}
            </span>
          </p>
          {/* aria-live: screen readers hear "Saved" after each pick */}
          {open && (
            <p aria-live="polite" className="flex items-center gap-1 text-sm text-slate-600">
              {savedAt ? (
                <>
                  <Icon name="check" className="h-4 w-4 text-emerald-700" /> Saved {savedAt}
                </>
              ) : (
                "Each result is saved as you pick it"
              )}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Audit progress</h2>
          <p className="text-sm tabular-nums text-slate-900">
            <span className="font-semibold">{progress.checked.toLocaleString("en-PH")}</span> of <span className="font-semibold">{progress.total.toLocaleString("en-PH")}</span> checked
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Audit progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.checked}
          aria-valuetext={`${progress.checked} of ${progress.total} checked`}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-navy-700 transition-[width]" style={{ width: `${progress.percent}%` }} />
        </div>
        {/* the counters, small and in one line. Each is also a link to that list */}
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {(
            [
              ["not_checked", "Not checked", counts.not_checked],
              ["found", "Found", counts.found],
              ["found_elsewhere", "Found elsewhere", counts.found_elsewhere],
              ["not_located", "Not located", counts.not_located],
            ] as const
          ).map(([v, label, n]) => (
            <div key={v} className="flex items-baseline gap-1.5">
              <dt>
                <Link href={href({ view: v })} className="text-slate-600 underline-offset-2 hover:text-navy-800 hover:underline">
                  {label}
                </Link>
              </dt>
              <dd className="font-semibold tabular-nums text-slate-900">{n.toLocaleString("en-PH")}</dd>
            </div>
          ))}
        </dl>
        {/* 0049: this audit was started on purpose while another one listed some of the same items */}
        {extra.overlapReason && <p className="mt-3 break-words text-sm text-amber-900">Separate audit (it overlaps another audit). Reason: &ldquo;{extra.overlapReason}&rdquo;</p>}
        {/* DD1: a discarded draft says who discarded it, when and why */}
        {discarded && (
          <p className="mt-3 break-words text-sm text-slate-700">
            Discarded{extra.discardedAt ? ` ${formatDateTime(extra.discardedAt)}` : ""}
            {extra.discardedBy ? ` by ${extra.discardedBy}` : ""}
            {extra.discardReason ? `: “${extra.discardReason}”` : ""}. Its checks below are kept as they were. It does not count as an audit.
          </p>
        )}
        {/* AV1: what this audit covered, said plainly, so a small list is never read as a count of the whole vault */}
        {!open && !discarded && <p className="mt-3 text-sm text-slate-700">Covered: {auditCoverage(audit).scope}. {audit.scope_vault || auditCoverage(audit).legacy ? "This was not a count of the whole vault." : ""}</p>}
        {!open && audit.notes && <p className="mt-3 break-words text-sm text-slate-700">Audit note: &ldquo;{audit.notes}&rdquo;</p>}
      </Card>

      {/* ---- 2. tabs, search, location, and the checklist ---- */}
      <Card padded={false}>
        <ViewTabs label="Audit views" tabs={tabs} current={view} />
        <ViewToolbar viewing={viewing} matches={q ? total : undefined}>
          <SearchBar action={base} defaultValue={q} placeholder="Search A-number, ticket, item, vault or customer" hidden={{ view: view !== "all" ? view : undefined, vault: vault || undefined, size: size !== 10 ? String(size) : undefined }} />
          {q && (
            <Link href={href({ q: "" })} className="text-sm font-medium text-navy-700 underline">
              Clear search
            </Link>
          )}
          {/* only when the audit covers more than one location */}
          {vaults.length > 1 && (
            <NavSelect
              label="Location"
              value={vault}
              options={[{ value: "", label: "All in this audit", href: href({ vault: "" }) }].concat(
                vaults.map((v) => ({ value: v.vault, label: `${v.vault} (${v.n.toLocaleString("en-PH")})`, href: href({ vault: v.vault }) })),
              )}
            />
          )}
        </ViewToolbar>

        {rows.length > 0 ? (
          <ul className="divide-y divide-slate-200">
            {rows.map((row) => (
              <AuditItem key={row.id} row={row} open={open} onSaved={onSaved} followups={followups.filter((f) => f.line_id === row.id)} showFollowups={!discarded} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="clipboard"
            title={q || vault ? "No items match" : view === "not_checked" ? "Nothing left to check" : "No items in this list"}
            description={q || vault ? "Try another search, or clear the filters." : view === "not_checked" ? "Every item in this audit has a result. Review the audit, then submit it." : undefined}
            action={
              q || vault || view !== "all" ? (
                <Link href={base} className={buttonClasses("secondary", "sm")}>
                  Show all items
                </Link>
              ) : undefined
            }
          />
        )}

        {/* ---- 3. pages ---- */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              Showing <span className="font-medium text-slate-900">{from}</span>–<span className="font-medium text-slate-900">{to}</span> of{" "}
              <span className="font-medium text-slate-900">{total.toLocaleString("en-PH")}</span>
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <NavSelect label="Per page" value={String(size)} options={AUDIT_PAGE_SIZES.map((n) => ({ value: String(n), label: String(n), href: href({ size: n }) }))} />
              {moved > 0 && view !== "all" && view !== "prior" ? (
                // the list changed under this page (items were checked), so "Next" would skip items: reload the list instead
                <button type="button" onClick={() => router.refresh()} className={buttonClasses("primary", "sm")}>
                  Show the next items
                </button>
              ) : (
                pages > 1 && (
                  <nav aria-label="Pages" className="flex items-center gap-2">
                    {page > 1 ? (
                      <Link href={href({ page: page - 1 })} className={buttonClasses("secondary", "sm")}>
                        Previous
                      </Link>
                    ) : (
                      <span aria-disabled="true" className={cx(buttonClasses("secondary", "sm"), "pointer-events-none opacity-60")}>
                        Previous
                      </span>
                    )}
                    <span className="text-xs">
                      Page {page} of {pages}
                    </span>
                    {page < pages ? (
                      <Link href={href({ page: page + 1 })} className={buttonClasses("secondary", "sm")}>
                        Next
                      </Link>
                    ) : (
                      <span aria-disabled="true" className={cx(buttonClasses("secondary", "sm"), "pointer-events-none opacity-60")}>
                        Next
                      </span>
                    )}
                  </nav>
                )
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ---- 4. the actions. Reaching the last page never submits anything: only the Submit button does ---- */}
      {open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* DD1: only for the person who started this draft, or an Admin. An empty span keeps the other buttons on the right */}
          {canDiscard ? (
            <DiscardDraft auditId={audit.id} location={scopeLabel(audit.scope_vault)} checked={progress.checked} total={progress.total} label="Discard this draft" onDone={() => router.push("/dashboard/inventory/audit")} />
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {/* the draft is already saved (every pick saves), so this just closes the audit for now */}
            <Link href="/dashboard/inventory/audit" className={buttonClasses("secondary")}>
              Save draft and close
            </Link>
            <ReviewButton
              data={data}
              counts={counts}
              progress={progress}
              hrefNotChecked={href({ view: "not_checked", q: "", vault: "" })}
              onSubmitted={(partial) => {
                toast.push(partial ? "Partial audit submitted." : "Audit submitted.", "success");
                router.refresh(); // the page comes back read only
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Link href="/dashboard/inventory/audit" className={buttonClasses("secondary")}>
            Back to Physical audit
          </Link>
        </div>
      )}
    </>
  );
}

/* ---------- one item ---------- */

// the look of each result button when it is the picked one. Every button has its WORD and a check mark when picked,
// so the result never depends on color alone.
const PICKED: Record<AuditResult, string> = {
  not_checked: "border-slate-500 bg-slate-200 text-slate-900",
  found: "border-emerald-700 bg-emerald-700 text-white",
  found_elsewhere: "border-amber-600 bg-amber-100 text-amber-950",
  not_located: "border-red-700 bg-red-700 text-white",
};
const RESULT_TONE: Record<AuditResult, "neutral" | "success" | "warning" | "danger"> = { not_checked: "neutral", found: "success", found_elsewhere: "warning", not_located: "danger" };
const inputClass = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

// showFollowups = false for a discarded draft: its problems never went to the follow-up list
function AuditItem({ row, open, onSaved, followups, showFollowups }: { row: AuditRow; open: boolean; onSaved: (row: AuditRow, from: AuditResult, to: AuditResult) => void; followups: Followup[]; showFollowups: boolean }) {
  const router = useRouter();
  // what is SAVED for this item (changes only after the database confirms a save)
  const [saved, setSaved] = useState({
    result: (row.result ?? "not_checked") as AuditResult,
    version: row.version,
    reason: row.reason ?? "",
    note: row.notes ?? "",
    place: row.found_location ?? "",
    at: row.checked_at,
    by: row.checked_by_name,
  });
  const [editing, setEditing] = useState<"found_elsewhere" | "not_located" | null>(null); // the small form that is open, if any
  const [reason, setReason] = useState(saved.reason); // typed in the small form (not saved yet)
  const [note, setNote] = useState(saved.note);
  const [place, setPlace] = useState(saved.place);
  const [saving, setSaving] = useState<AuditResult | null>(null); // the result being saved right now
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);
  const [details, setDetails] = useState(false); // the "More details" part is open
  const [photos, setPhotos] = useState<{ urls: string[]; error?: string; loading?: boolean } | null>(null);
  const busy = useRef(false); // true while a save is running, so a double tap can't send two

  const ref = appraisalNo(row.appraisal_no); // "A-0045"
  const title = `${categoryLabel(row.category, row.category_other)} · ${row.karat ?? "?"}K · ${row.weight_grams ?? "?"} g`;
  const name = ref || title; // what screen readers call this item
  const vaultName = row.expected_vault ?? row.current_vault ?? "No location";
  const custody = CUSTODY[row.item_status as InventoryStatus]; // where the item is now, in words

  // send one result to the database; the screen changes only when it is saved
  async function save(result: AuditResult) {
    if (busy.current) return;
    const problem = auditResultProblem(result, reason, note, place); // e.g. "Pick a reason."
    if (problem) return setError({ text: problem });
    busy.current = true;
    setSaving(result);
    setError(null);
    try {
      const res = await saveAuditResult({ lineId: row.id, result, version: saved.version, reason, note, place });
      if (res.ok) {
        const from = saved.result;
        const keep = result === "not_located" || result === "found_elsewhere"; // only these keep a note
        setSaved({
          result,
          version: res.version,
          reason: result === "not_located" ? reason : "",
          note: keep ? note.trim() : "",
          place: result === "found_elsewhere" ? place.trim() : "",
          at: result === "not_checked" ? null : new Date().toISOString(),
          by: result === "not_checked" ? null : "you",
        });
        if (!keep) {
          setReason("");
          setNote("");
          setPlace("");
        }
        setEditing(null);
        onSaved(row, from, result);
      } else {
        setError({ text: res.error, stale: res.stale });
      }
    } catch {
      // no connection, or the server did not answer: nothing was changed on the screen
      setError({ text: "Could not save. Check the connection, then pick the result again." });
    } finally {
      busy.current = false;
      setSaving(null);
    }
  }

  // a result button was pressed
  function pick(result: AuditResult) {
    setError(null);
    if (result === "found_elsewhere" || result === "not_located") {
      // these need a few words first, so a small form opens; nothing is saved until "Save" there
      if (editing !== result) {
        setReason(saved.result === result ? saved.reason : "");
        setNote(saved.result === result ? saved.note : "");
        setPlace(saved.result === result ? saved.place : "");
      }
      setEditing(result);
      return;
    }
    setEditing(null);
    if (result !== saved.result) save(result); // Found and Not checked save at once
  }

  async function showPhotos() {
    if (!row.appraisal_item_id) return;
    setPhotos({ urls: [], loading: true });
    try {
      setPhotos(await auditItemPhotos(row.appraisal_item_id));
    } catch {
      setPhotos({ urls: [], error: "Could not load the photos." });
    }
  }

  return (
    <li className={cx("px-4 py-3 sm:px-5", saved.result === "not_checked" && open && "bg-white", saved.result !== "not_checked" && "bg-slate-50/60")}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        {/* left: which item this is */}
        <div className="min-w-0 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-slate-900">
            <span>{title}</span>
            {ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800">{ref}</span>}
            {/* the result as a word, for a submitted audit (no buttons there) */}
            {!open && (
              <Badge tone={RESULT_TONE[saved.result]} icon={saved.result === "not_located"}>
                {resultLabel(saved.result)}
              </Badge>
            )}
          </p>
          <p className="mt-0.5 break-words text-slate-600">
            <span className="font-medium text-slate-800">{vaultName}</span>
            {row.ticket_number ? ` · Ticket ${row.ticket_number}` : ""}
            {row.customer_name ? ` · ${row.customer_name}` : ""}
          </p>

          {/* history from an EARLIER audit. It is shown apart from today's result and never fills it in */}
          {row.prior_open && row.prior_at && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Earlier audit ({formatDate(row.prior_at)}): {row.prior_result === "found_elsewhere" ? "found in the wrong place" : "not located"}, not followed up yet. Check this one carefully.
              </span>
            </p>
          )}
          {/* the item left the shop after the audit started (released or sold) */}
          {!row.in_custody && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-xs text-slate-800">
              <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {custody?.label ?? humanize(row.item_status)} after this audit started ({custody?.where.toLowerCase() ?? "no longer in the shop"}). It does not need a check.
              </span>
            </p>
          )}

          {/* what is saved for a problem result */}
          {saved.result === "not_located" && (
            <p className="mt-1.5 break-words text-xs text-slate-700">
              Reason: {reasonLabel(saved.reason) || "not given"}
              {saved.note && <span className="italic"> · &ldquo;{saved.note}&rdquo;</span>}
            </p>
          )}
          {saved.result === "found_elsewhere" && (
            <p className="mt-1.5 break-words text-xs text-slate-700">
              Found at: {saved.place || "not given"}
              {saved.note && <span className="italic"> · &ldquo;{saved.note}&rdquo;</span>}
            </p>
          )}
          {saved.result !== "not_checked" && saved.at && (
            <p className="mt-1 text-xs text-slate-500">
              Checked {formatDateTime(saved.at)}
              {saved.by ? ` by ${saved.by}` : ""}
            </p>
          )}

          {/* AD1: what happened AFTER the audit. Kept apart: the result above is what was found on the audit day */}
          {!open && showFollowups && (saved.result === "not_located" || saved.result === "found_elsewhere") && (
            <div className="mt-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
              <p className="font-medium text-slate-900">After the audit: {followups.some((f) => f.outcome === "found_expected") ? "resolved" : followups.length ? "still open" : "no follow-up yet"}</p>
              {followups.map((f, i) => (
                <p key={i} className="break-words">
                  {followupLabel(f.outcome)}
                  {f.found_location ? ` (${f.found_location})` : ""} · {formatDateTime(f.at)} · {f.by ?? "staff"} · <span className="italic">&ldquo;{f.notes}&rdquo;</span>
                </p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setDetails((d) => !d)}
            aria-expanded={details}
            className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          >
            {details ? "Hide details" : "More details"}
            <Icon name={details ? "chevron-up" : "chevron-down"} className="h-3 w-3" />
          </button>
        </div>

        {/* right: the result. One button is always the picked one, so two results can't be chosen together */}
        {open && (
          <div role="group" aria-label={`Result for ${name}`} className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap lg:justify-end">
            {AUDIT_RESULTS.map((r) => {
              const picked = saved.result === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={picked}
                  disabled={saving !== null}
                  onClick={() => pick(r.value)}
                  className={cx(
                    // min-h-11 = big enough for a finger on a phone; smaller on a computer
                    "inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-70 sm:min-h-9",
                    picked ? PICKED[r.value] : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                    editing === r.value && !picked && "border-navy-600 ring-1 ring-navy-600",
                  )}
                >
                  {saving === r.value ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                  ) : (
                    picked && <Icon name="check" className="h-3.5 w-3.5" />
                  )}
                  {r.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* the small form for Not located / Found elsewhere */}
      {open && editing && (
        <form
          className="mt-3 grid gap-3 rounded-md border border-slate-300 bg-white p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault(); // no page reload
            save(editing);
          }}
        >
          {editing === "not_located" ? (
            <label className="block text-sm font-medium text-slate-700">
              Why could it not be located? <span className="text-red-600" aria-hidden="true">*</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus className={inputClass}>
                <option value="">Pick a reason</option>
                {AUDIT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm font-medium text-slate-700">
              Where was it found? <span className="text-red-600" aria-hidden="true">*</span>
              <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} required minLength={2} maxLength={120} autoFocus placeholder="e.g. Vault B, shelf 2" className={inputClass} />
            </label>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Note {editing === "not_located" && reason === "other" ? <span className="text-red-600" aria-hidden="true">*</span> : <span className="font-normal text-slate-500">(optional)</span>}
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What you saw" className={inputClass} />
          </label>
          <p className="text-xs text-slate-600 sm:col-span-2">
            {editing === "not_located"
              ? "This only records what you saw today. The item, its loan and its status are not changed; it goes to the follow-up list after the audit is submitted."
              : "The item is in the shop, just not where the system says. It goes to the follow-up list so someone can put it back or correct its location."}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={saving !== null} className={buttonClasses("primary", "sm")}>
              {saving ? "Saving" : `Save as ${resultLabel(editing)}`}
            </button>
            <button type="button" onClick={() => (setEditing(null), setError(null))} className={buttonClasses("secondary", "sm")}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* a save that did not work. The buttons above still show what IS saved */}
      {error && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error.text}</span>
          {error.stale && (
            <button type="button" onClick={() => router.refresh()} className={buttonClasses("secondary", "sm")}>
              Show the latest
            </button>
          )}
        </p>
      )}

      {/* more ways to tell this item apart from a similar one */}
      {details && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Appraisal no.">{ref || "None"}</Detail>
            <Detail label="Pawn ticket">{row.ticket_number ?? "No loan"}</Detail>
            <Detail label="Pawner">{row.customer_name ?? "Not recorded"}</Detail>
            <Detail label="Item">{title}</Detail>
            <Detail label="Expected location">{vaultName}</Detail>
            <Detail label="Custody now">
              {custody?.label ?? humanize(row.item_status)}
              {row.loan_status ? ` · loan ${humanize(row.loan_status).toLowerCase()}` : ""}
            </Detail>
            {row.expected_vault && row.current_vault && row.expected_vault !== row.current_vault && <Detail label="Location in the system now">{row.current_vault} (changed after the audit started)</Detail>}
            <div className="sm:col-span-2 lg:col-span-3">
              <Detail label="Notes from the appraisal">{row.condition_notes?.trim() || "None written"}</Detail>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {row.photo_count > 0 && !photos?.urls.length && (
              <button type="button" onClick={showPhotos} disabled={photos?.loading} className={buttonClasses("secondary", "sm")}>
                {photos?.loading ? "Loading photos" : `Show photos (${row.photo_count})`}
              </button>
            )}
            {row.photo_count === 0 && <span className="text-xs text-slate-600">No photos were taken at the appraisal.</span>}
            {row.appraisal_item_id && (
              <Link href={`/dashboard/appraisals/${row.appraisal_item_id}`} className="text-xs font-medium text-navy-700 underline">
                Open the appraisal
              </Link>
            )}
          </div>
          {photos?.error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {photos.error}
            </p>
          )}
          {photos && photos.urls.length > 0 && <PhotoGrid className="mt-3" photos={photos.urls.map((url, i) => ({ url, alt: `${title}${ref ? `, ${ref}` : ""}, photo ${i + 1}` }))} />}
        </div>
      )}
    </li>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{children}</dd>
    </div>
  );
}

/* ---------- review and submit ---------- */

// Step 1: the totals of the audit. Step 2: "Submit?" with a clear warning. Nothing is submitted before step 2.
function ReviewButton({
  data,
  counts,
  progress,
  hrefNotChecked,
  onSubmitted,
}: {
  data: AuditPage;
  counts: AuditPage["counts"];
  progress: { checked: number; total: number };
  hrefNotChecked: string;
  onSubmitted: (partial: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null); // the popup
  const [shown, setShown] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false); // step 2 is showing
  const [agree, setAgree] = useState(false); // the tick for a partial audit
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partial = counts.not_checked > 0; // items are still Not checked
  const checkers = (data.counts.checkers ?? []).join(", ");

  useEffect(() => {
    if (shown) ref.current?.showModal(); // on top of the page
  }, [shown]);

  function close() {
    ref.current?.close();
    setShown(false);
    setConfirming(false);
    setAgree(false);
    setError(null);
  }

  async function submit() {
    if (pending) return; // pressed twice = once
    setPending(true);
    setError(null);
    try {
      const res = await submitAuditSession(data.audit.id, partial, notes);
      if (res.ok) {
        close();
        onSubmitted(res.partial);
      } else {
        setError(res.error);
        setConfirming(false);
      }
    } catch {
      setError("Could not submit. Check the connection and try again. Your results are still saved.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  const line = (label: string, value: ReactNode, strong = false) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cx("text-right tabular-nums text-slate-900", strong && "font-semibold")}>{value}</dd>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setShown(true)} className={buttonClasses("primary")}>
        Review audit
      </button>
      {shown && (
        <dialog
          ref={ref}
          aria-label="Review audit"
          onClose={(e) => e.target === e.currentTarget && close()}
          onClick={(e) => e.target === e.currentTarget && !pending && close()} // a click on the dark area closes it
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Review audit</h2>
            <button type="button" onClick={close} disabled={pending} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">
            <dl className="divide-y divide-slate-100">
              {line("Location", scopeLabel(data.audit.scope_vault))}
              {line("Started", `${formatDateTime(data.audit.started_at)}${data.audit.started_by ? ` by ${data.audit.started_by}` : ""}`)}
              {checkers && line("Checked by", checkers)}
              {line("Items expected", counts.expected.toLocaleString("en-PH"), true)}
              {line("Found", counts.found.toLocaleString("en-PH"))}
              {line("Found elsewhere (wrong place)", counts.found_elsewhere.toLocaleString("en-PH"))}
              {line("Not located", counts.not_located.toLocaleString("en-PH"))}
              {line("Not checked", counts.not_checked.toLocaleString("en-PH"), partial)}
              {counts.left > 0 && line("Left the shop during the audit (no check needed)", counts.left.toLocaleString("en-PH"))}
              {line("Had a problem in an earlier audit", `${counts.prior.toLocaleString("en-PH")}${counts.prior ? ` (${counts.prior_found_now.toLocaleString("en-PH")} found today)` : ""}`)}
              {line("New problems in this audit", counts.new_findings.toLocaleString("en-PH"))}
            </dl>

            {partial ? (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                <p className="font-semibold">
                  {counts.not_checked.toLocaleString("en-PH")} {counts.not_checked === 1 ? "item is" : "items are"} still Not checked ({progress.checked.toLocaleString("en-PH")} of {progress.total.toLocaleString("en-PH")} done).
                </p>
                <p className="mt-1">Not checked does not mean missing. You can go back and check them, or submit this as a partial audit: it is labelled Partial and keeps the number left.</p>
                <Link href={hrefNotChecked} onClick={close} className="mt-2 inline-block font-medium underline">
                  Go to the items not checked
                </Link>
              </div>
            ) : (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">Every item has a result.</p>
            )}

            <p className="text-slate-600">Submitting does not change any item, loan or status. Items marked Not located or Found elsewhere go to the follow-up list on the Physical audit page.</p>

            <label className="block font-medium text-slate-700">
              Audit note <span className="font-normal text-slate-500">(optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder="e.g. Monthly count of Safe 1" className={inputClass} />
            </label>

            {partial && (
              <label className="flex items-start gap-2 text-slate-800">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-400 text-navy-700 focus:ring-navy-500" />
                <span>
                  Submit it as a partial audit with {counts.not_checked.toLocaleString("en-PH")} {counts.not_checked === 1 ? "item" : "items"} left Not checked.
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
                {error}
              </p>
            )}

            {confirming ? (
              // step 2: the last question
              <div role="alertdialog" aria-label="Submit this audit?" className="rounded-md border border-slate-300 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">Submit this {partial ? "partial " : ""}audit?</p>
                <p className="mt-1 text-slate-700">After this, its results can&rsquo;t be changed.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={submit} disabled={pending} autoFocus className={buttonClasses("primary")}>
                    {pending ? "Submitting" : "Yes, submit"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={buttonClasses("secondary")}>
                    Not yet
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={close} className={buttonClasses("secondary")}>
                  Keep checking
                </button>
                <button type="button" onClick={() => setConfirming(true)} disabled={partial && !agree} className={buttonClasses("primary")}>
                  {partial ? "Submit partial audit" : "Submit audit"}
                </button>
              </div>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
