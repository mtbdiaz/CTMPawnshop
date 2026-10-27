import { Montserrat } from "next/font/google";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-montserrat" });

// The pawn ticket is a pre-set form on half-letter paper (8.5 x 6.5 in, landscape).
export const FORM_PAGE_CSS = "@page{size:215.9mm 165.1mm;margin:0}";

export default function FormLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{FORM_PAGE_CSS}</style>
      <div className={`${montserrat.variable} pawn-form-wrap`}>{children}</div>
    </>
  );
}
