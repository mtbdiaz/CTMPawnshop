import Link from "next/link";
import { buttonClasses } from "@/components/ui";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-mono text-sm font-medium text-gold-600">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-navy-900">Record not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        The customer, appraisal, or loan you&apos;re looking for doesn&apos;t exist or may have been
        removed. Check the link, or find it from its list page.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/dashboard" className={buttonClasses("primary")}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
