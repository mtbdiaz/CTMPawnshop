import Link from "next/link";
import { buttonClasses } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm font-medium text-gold-600">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-navy-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">That address doesn&apos;t match any page in CTM PawnTrack.</p>
        <Link href="/dashboard" className={`${buttonClasses("primary")} mt-6`}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
