export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="h-3 w-40 rounded bg-slate-200" />
      <div className="mt-3 h-7 w-72 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-slate-200" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mb-4 h-4 rounded bg-slate-100 last:mb-0" />
        ))}
      </div>
    </div>
  );
}
