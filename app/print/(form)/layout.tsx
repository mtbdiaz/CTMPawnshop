import { Montserrat, Poppins } from "next/font/google";
import { TICKET_PAGE } from "@/lib/ticket-layout";

// The two families (and weights) used in the owner's ticket PDF.
const montserrat = Montserrat({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["300", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-montserrat",
});
const poppins = Poppins({ subsets: ["latin"], weight: ["300", "600"], variable: "--font-poppins" });

// The pawn ticket is a pre-set form on half-letter paper (8.5 x 6.5 in, landscape).
const PAGE_CSS = `@page{size:${TICKET_PAGE.w}pt ${TICKET_PAGE.h}pt;margin:0}`;

export default function FormLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className={`${montserrat.variable} ${poppins.variable} pawn-form-wrap`}>{children}</div>
    </>
  );
}
