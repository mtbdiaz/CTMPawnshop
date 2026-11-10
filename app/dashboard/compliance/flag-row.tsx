"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, TD, TR, ViewButton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { resolveSuspiciousFlag } from "./actions";

export function FlagRow({
  flagId,
  reason,
  customerId,
  customerName,
  customerNumber,
  summary,
  createdAt,
  status,
}: {
  flagId: string;
  reason: string;
  customerId: string | null;
  customerName: string;
  customerNumber: string; // C-0012
  summary: string | null; // SA1: "3 loans in 24 hours · ₱19,500.00 total · Sep 5, 2026" (null if it can't be worked out)
  createdAt: string;
  status: string;
}) {
  return (
    <TR highlight={status === "open" ? "warning" : undefined}>
      <TD>
        <span className="font-medium">{customerName}</span>
        <span className="block font-mono text-xs text-slate-500">{customerNumber}</span>
        <span className="block text-xs text-slate-500">{formatDateTime(createdAt)}</span>
        {/* SA2: where the flag stands. "Investigating" used to be invisible: the button just disappeared */}
        <span className="mt-1 block">{status === "investigating" ? <Badge tone="info">Investigating</Badge> : <Badge tone="warning">Open</Badge>}</span>
      </TD>
      <TD>
        {reason}
        {/* SA1: the numbers behind the flag, and a way to see those loans */}
        {summary && <span className="mt-1 block text-xs font-medium text-slate-700">{summary}</span>}
        {customerName && (
          <Link
            href={`/dashboard/loans?status=all&q=${encodeURIComponent(customerName)}`}
            className="mt-1 inline-block rounded-sm text-xs font-medium text-navy-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          >
            View loans
          </Link>
        )}
      </TD>
      <TD>
        <ActionForm action={resolveSuspiciousFlag} successMessage="Flag updated." className="flex flex-wrap gap-2">
          <input type="hidden" name="flag_id" value={flagId} />
          {/* #14: optional note saved with whichever decision is pressed (shown in the Resolved tab) */}
          <input
            type="text"
            name="resolution_notes"
            maxLength={500}
            placeholder="Note (optional), e.g. Customer explained: family members' loans"
            aria-label={`Note for the flag on ${customerName}`}
            className="w-full basis-full rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
          {customerId && <ViewButton href={`/dashboard/customers/${customerId}`}>View customer</ViewButton>}
          {/* SA3 + SA4: the words say what it means, and it asks first because a dismissed flag can't be reopened */}
          <SubmitButton
            name="decision"
            value="dismissed"
            variant="secondary"
            size="sm"
            confirm={{
              title: `Dismiss the flag on ${customerName}?`,
              message: "Use this when the activity looks normal. The flag moves to Resolved and can't be reopened. The customer is not blocked.",
              confirmLabel: "Dismiss flag",
              tone: "primary",
            }}
          >
            Looks normal, dismiss
          </SubmitButton>
          {status !== "investigating" && (
            <SubmitButton name="decision" value="investigating" variant="secondary" size="sm">
              Mark investigating
            </SubmitButton>
          )}
          <SubmitButton
            name="decision"
            value="blacklisted"
            variant="danger"
            size="sm"
            confirm={{
              title: `Blacklist ${customerName}?`,
              message: "The customer will be blocked from all new appraisals and loans until an Admin removes the flag.",
              confirmLabel: "Blacklist customer",
            }}
          >
            Blacklist customer
          </SubmitButton>
        </ActionForm>
      </TD>
    </TR>
  );
}
