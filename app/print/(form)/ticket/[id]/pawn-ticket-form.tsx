import { formatDate, formatPeso } from "@/lib/format";
import { pesoWords } from "@/lib/words";

function Fill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-block min-w-8 border-b border-black px-1 font-semibold ${className}`}>{children}</span>;
}

export type PawnTicketProps = {
  ticketNumber: string;
  loanDate: string;
  maturityDate: string;
  redemptionExpiry: string;
  customerName: string;
  address: string;
  principal: number;
  interestRatePercent: number;
  interest: number;
  serviceCharge: number;
  appraised: number | null;
  description: string;
};

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

// CTM's own pawn ticket form (half-letter, landscape). Wording and layout follow
// the pre-printed form supplied by the owner.
export function PawnTicketForm(p: PawnTicketProps) {
  const longDescription = p.description.length > 220;
  return (
    <article className="pawn-form">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[34px] font-extrabold leading-none tracking-wide">CTM PAWNSHOP</h1>
          <p className="mt-1 text-[9.5px] leading-tight text-slate-700">63 Rizal St., Poblacion Kiblawan Davao del Sur</p>
          <p className="text-[9.5px] font-medium italic leading-tight">THERESE B. DIAZ - PROP.*</p>
          <p className="text-[9.5px] leading-tight text-slate-700">NON-VAT REG. TIN: 948-317-198-0000</p>
        </div>
        <div className="w-[60mm] border border-black px-3 py-2.5">
          <span className="text-[13px] font-bold">NO </span>
          <span className="font-mono text-[13px] font-semibold">{p.ticketNumber}</span>
        </div>
      </header>

      <div className="mt-4 flex justify-between text-[11px]">
        <p>
          Date Loan Granted: <b>{formatDate(p.loanDate)}</b>
        </p>
        <div>
          <p>
            Maturity Date: <b>{formatDate(p.maturityDate)}</b>
          </p>
          <p>
            Expiry Date of Redemption Period: <b>{formatDate(p.redemptionExpiry)}</b>
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-[9px] text-[11px] leading-[1.35]">
        <p className="flex items-end gap-1.5">
          <span className="shrink-0">Mr./Mrs./Miss</span>
          <Fill className="min-w-0 flex-1">{p.customerName}</Fill>
        </p>
        <p className="flex items-end gap-1.5">
          <span className="shrink-0">a resident of</span>
          <Fill className={`min-w-0 flex-1 ${p.address.length > 90 ? "text-[9px]" : ""}`}>{p.address}</Fill>
        </p>
        <p className="flex items-end gap-1">
          <span className="shrink-0">for a loan of PESOS</span>
          <Fill className={`min-w-0 flex-1 leading-tight ${pesoWords(p.principal).length > 60 ? "text-[8px]" : "text-[9.5px]"}`}>{pesoWords(p.principal)}</Fill>
          <span>(₱</span>
          <Fill className="w-[30mm] text-right">{peso(p.principal)}</Fill>
          <span>)</span>
        </p>
        <p className="text-justify">
          with an interest of <Fill className="w-[14mm] text-center">{p.interestRatePercent}</Fill>% P.M. has pledges to this Pawnee in security for the loan
          of article(s) described below appraised at{" "}
          <span className="whitespace-nowrap">
            ₱<Fill className="w-[30mm] text-right">{p.appraised === null ? "" : peso(p.appraised)}</Fill>
          </span>{" "}
          subject to the terms and
          conditions stated on the reverse side hereof.
        </p>
      </div>

      <p className="ml-[20mm] mt-4 text-[11.5px] font-semibold">(Description of the Pawn)</p>
      <div className="mt-1 flex gap-[9mm]">
        <div className="h-[40mm] w-[92mm] shrink-0 overflow-hidden border border-black p-2 text-[10px] leading-snug">
          <span className={longDescription ? "text-[8.5px]" : ""}>{p.description}</span>
        </div>
        <table className="h-[30mm] w-[86mm] border-collapse self-start border-2 border-black text-[11px]">
          <tbody>
            {[
              ["Principal", p.principal],
              ["Interest", p.interest],
              ["Service Charge", p.serviceCharge],
              ["Net Proceeds", p.principal - p.serviceCharge],
            ].map(([label, value]) => (
              <tr key={String(label)} className="border border-black">
                <td className="w-[50%] border-r-2 border-black px-2 py-[3px] text-slate-700">{label}</td>
                <td className="px-2 py-[3px] font-semibold tabular-nums">{formatPeso(Number(value))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="absolute inset-x-[12mm] bottom-[6mm]">
        <div className="flex justify-between gap-12 text-center">
          <div className="w-[78mm]">
            <div className="mt-6 border-t border-black" />
            <p className="text-[9.5px] text-slate-700">(Signature or Thumbmark)</p>
            <p className="text-[9.5px] font-bold">Pawner</p>
          </div>
          <div className="w-[78mm]">
            <div className="mt-6 border-t border-black" />
            <p className="text-[9.5px] text-slate-700">(Signature or Thumbmark)</p>
            <p className="text-[9.5px] font-bold">Pawnshop&apos;s Authorized Representative</p>
          </div>
        </div>
        <div className="mt-3 flex justify-between gap-8">
          <p className="w-[95mm] text-center text-[10px] font-extrabold leading-tight">
            PAWNER IS ADVISED TO READ AND UNDERSTAND THE TERMS AND CONDITIONS ON THE REVERSE SIDE HEREOF.
          </p>
          <p className="w-[80mm] text-[6.5px] font-semibold italic leading-tight">
            &quot;THIS DOCUMENT IS NOT VALID FOR CLAIMING OF INPUT TAXES&quot;
            <br />
            &quot;THIS PAWN TICKET SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP.&quot;
          </p>
        </div>
      </div>
    </article>
  );
}
