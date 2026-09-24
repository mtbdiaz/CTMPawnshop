"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClasses } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-700">
        <Icon name="alert" className="h-6 w-6" />
      </div>
      <h1 className="mt-4 font-display text-2xl font-semibold text-navy-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        This page couldn&apos;t be loaded — usually a brief connection problem with the database. Your
        data is safe. Try again, and if it keeps happening, let an Admin know.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClasses("primary")}>
          Try again
        </button>
        <Link href="/dashboard" className={buttonClasses("secondary")}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
