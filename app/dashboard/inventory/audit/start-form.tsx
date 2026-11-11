"use client"; // runs in the browser: the location dropdown and what shows under it

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation"; // opens the audit after it is started
import { ActionForm, SubmitButton } from "@/components/form";
import { RequestIdInput } from "@/components/request-id"; // a one-time id, so Start pressed twice makes one audit
import { buttonClasses } from "@/components/ui";
import { Icon } from "@/components/icons";
import { startAudit, type ActionState } from "../actions";

// an audit that is in progress, as the form needs it
// shared = how many of its items are at each location NOW (counted item by item in the database, 0049)
export type OpenDraft = { id: string; scope: string; checked: number; total: number; startedBy: string | null; shared: Record<string, number> }; // scope "" = all locations

// AS1 + DD1 (Nov 12, migration 0048): start a physical audit, or continue the one that is already open.
// locations = the places that really have items in the vault now, with how many (nothing is made up).
// What shows under the dropdown depends on the location that is picked (changing the dropdown starts nothing):
//   - that location already has an open audit   -> "Continue audit" (a link to it; no second audit can be made)
//   - another open audit lists some of the same items -> a warning that names it, and Start only after ticking
//     "separate audit" AND writing why (0049). Operator and Admin can do this: the same roles that can audit.
//   - nothing in the way                         -> "Start audit"
// The database checks all of this again when Start is pressed.
export function StartAuditForm({ locations, total, open }: { locations: { vault: string; n: number }[]; total: number; open: OpenDraft[] }) {
  const router = useRouter();
  const [scope, setScope] = useState(""); // "" = all locations
  const [separate, setSeparate] = useState(false); // the tick for an overlapping audit

  const same = open.find((a) => a.scope === scope); // an open audit of exactly this location
  // open audits that list some of the SAME ITEMS this audit would list (by item, not by the location's name):
  // for All locations = any item at all; for one location = items that are at that location now
  const sharedWith = (a: OpenDraft) => (scope === "" ? Object.values(a.shared).reduce((sum, n) => sum + n, 0) : (a.shared[scope] ?? 0));
  const overlapping = same ? [] : open.filter((a) => sharedWith(a) > 0);
  const name = (s: string) => s || "All locations";

  return (
    <ActionForm<ActionState>
      action={startAudit}
      className="space-y-3"
      onSuccess={(state) => state.id && router.push(`/dashboard/inventory/audit/${state.id}`)} // open the audit that was started
    >
      {(state) => (
        <>
      <RequestIdInput />
      <label className="block text-sm font-medium text-slate-700 sm:max-w-sm">
        Location to audit
        <select
          name="scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setSeparate(false); // a tick (and its reason) for one location must not carry over to another
          }}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
        >
          <option value="">
            All locations ({total.toLocaleString("en-PH")} items){open.some((a) => a.scope === "") ? ", in progress" : ""}
          </option>
          {locations.map((l) => (
            <option key={l.vault} value={l.vault}>
              {l.vault} ({l.n.toLocaleString("en-PH")} {l.n === 1 ? "item" : "items"}){open.some((a) => a.scope === l.vault) ? ", in progress" : ""}
            </option>
          ))}
        </select>
      </label>

      {same ? (
        // this location already has an audit: continue it, never a second one
        <div className="space-y-2" aria-live="polite">
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
            <span>
              <span className="font-medium text-slate-900">An audit of {name(scope)} is already in progress.</span>{" "}
              {same.checked.toLocaleString("en-PH")} of {same.total.toLocaleString("en-PH")} checked{same.startedBy ? `, started by ${same.startedBy}` : ""}. Continue it instead of starting another.
            </span>
          </p>
          <Link href={`/dashboard/inventory/audit/${same.id}`} className={buttonClasses("primary")}>
            Continue audit
          </Link>
        </div>
      ) : (
        <div className="space-y-2" aria-live="polite">
          {overlapping.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Some of these items are already in an audit in progress:</p>
              <ul className="mt-1 list-disc pl-5">
                {overlapping.map((a) => (
                  <li key={a.id}>
                    {name(a.scope)} <span className="font-mono text-xs">{a.id.slice(0, 8)}</span>: {sharedWith(a).toLocaleString("en-PH")} {sharedWith(a) === 1 ? "item" : "items"} the same{a.startedBy ? `, started by ${a.startedBy}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Continue that audit from the list if you can. A new one here is a separate audit: its results are its own and never change the other audit.</p>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" name="allow_overlap" checked={separate} onChange={(e) => setSeparate(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-400 text-navy-700 focus:ring-navy-500" />
                <span>Start a separate audit of {name(scope)} anyway.</span>
              </label>
              {/* the reason is asked only after the tick, and is saved with the audit (with who started it and when) */}
              {separate && (
                <label className="mt-2 block font-medium">
                  Why is a separate audit needed? <span className="text-red-700" aria-hidden="true">*</span>
                  {/* key = the location: picking another location gives an empty box */}
                  <input key={scope} type="text" name="overlap_reason" required minLength={5} maxLength={300} placeholder="e.g. Spot check of Safe 1 after auction prep" className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20" />
                  {state.fieldErrors?.overlap_reason && <span className="mt-1 block text-xs text-red-700">{state.fieldErrors.overlap_reason}</span>}
                </label>
              )}
            </div>
          )}
          <SubmitButton pendingLabel="Starting" disabled={overlapping.length > 0 && !separate}>
            {overlapping.length > 0 ? "Start separate audit" : "Start audit"}
          </SubmitButton>
        </div>
      )}
        </>
      )}
    </ActionForm>
  );
}
