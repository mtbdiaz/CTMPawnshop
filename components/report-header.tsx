import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "./ui";
import { PrintButton } from "./print-button";

/** Report page header: on screen a normal page header; on paper a CTM letterhead with the generation time. */
export function ReportHeader({ title, description, subtitle }: { title: string; description?: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <div className="mb-6 hidden border-b-2 border-navy-900 pb-3 print:block">
        <p className="font-display text-lg font-semibold text-navy-900">CTM Pawnshop</p>
        <p className="text-base font-semibold">{title}</p>
        {subtitle && <p className="text-sm">{subtitle}</p>}
        <p className="text-xs text-slate-600">Generated {formatDateTime(new Date())}</p>
      </div>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={
            <>
              {description}
              {subtitle && <span className="mt-1 block font-medium text-slate-700">{subtitle}</span>}
            </>
          }
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Reports", href: "/dashboard/reports" },
            { label: title },
          ]}
          actions={<PrintButton />}
        />
      </div>
    </>
  );
}
