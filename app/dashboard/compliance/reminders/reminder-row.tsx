"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, TD, TR, TableLink } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { sendReminder, type ActionState } from "../actions";

export function ReminderRow({
  loanId,
  ticketNumber,
  customerName,
  contactNumber,
  maturityDate,
  daysLeft,
  owed,
  alreadySent,
}: {
  loanId: string;
  ticketNumber: string;
  customerName: string;
  contactNumber: string;
  maturityDate: string;
  daysLeft: number;
  owed: number;
  alreadySent: boolean;
}) {
  return (
    <TR highlight={daysLeft === 0 ? "warning" : undefined}>
      <TD>
        <span className="font-medium">{customerName}</span>
        <a href={`tel:${contactNumber}`} className="block text-xs text-navy-700 hover:underline">
          {contactNumber}
        </a>
      </TD>
      <TD mono>
        <TableLink href={`/dashboard/loans/${loanId}`}>{ticketNumber}</TableLink>
      </TD>
      <TD>
        {formatDate(maturityDate)}
        <span className="block text-xs font-medium text-amber-800">
          {daysLeft === 0 ? "Due today" : `In ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
        </span>
      </TD>
      <TD align="right">{formatPeso(owed)}</TD>
      <TD>
        <ActionForm action={sendReminder} successMessage={`Reminder logged for ${customerName}.`}>
          {(state: ActionState) =>
            alreadySent || state.success ? (
              <Badge tone="success">Reminder logged</Badge>
            ) : (
              <>
                <input type="hidden" name="loan_id" value={loanId} />
                <SubmitButton variant="secondary" size="sm" pendingLabel="Logging…">
                  Mark reminded
                </SubmitButton>
              </>
            )
          }
        </ActionForm>
      </TD>
    </TR>
  );
}
