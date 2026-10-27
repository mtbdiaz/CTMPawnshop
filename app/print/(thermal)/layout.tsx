import { thermalCss } from "@/lib/print";

export default function ThermalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{thermalCss()}</style>
      <main className="thermal">{children}</main>
    </>
  );
}
