"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { TD, TR, ViewButton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { resolveSuspiciousFlag } from "./actions";

export function FlagRow({
  flagId,
  reason,
  customerId,
  customerName,
  createdAt,
  status,
}: {
  flagId: string;
  reason: string;
  customerId: string | null;
  customerName: string;
  createdAt: string;
  status: string;
}) {
  return (
    <TR highlight={status === "open" ? "warning" : undefined}>
      <TD>
        <span className="font-medium">{customerName}</span>
        <span className="block text-xs text-slate-500">{formatDateTime(createdAt)}</span>
      </TD>
      <TD>{reason}</TD>
      <TD>
        <ActionForm action={resolveSuspiciousFlag} successMessage="Flag updated." className="flex flex-wrap gap-2">
          <input type="hidden" name="flag_id" value={flagId} />
          {customerId && <ViewButton href={`/dashboard/customers/${customerId}`}>View customer</ViewButton>}
          <SubmitButton name="decision" value="dismissed" variant="secondary" size="sm">
            Dismiss
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
            Blacklist
          </SubmitButton>
        </ActionForm>
      </TD>
    </TR>
  );
}
