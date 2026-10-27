import type { ReactNode } from "react";

export function SlipHeader({ title }: { title: string }) {
  return (
    <header className="text-center">
      <p className="text-[13px] font-bold">CTM PAWNSHOP</p>
      <p>{title}</p>
    </header>
  );
}

export function SlipRule() {
  return <hr className="my-1.5 border-0 border-t border-dashed border-black" />;
}

export function SlipRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-2 font-bold" : "flex justify-between gap-2"}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

export function SlipBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <div className="break-words pl-2">{children}</div>
    </div>
  );
}
