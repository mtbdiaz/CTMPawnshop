import type { CSSProperties } from "react";
import { formatDate } from "@/lib/format";
import { pesoWords } from "@/lib/words";
import { TICKET_FIELDS, TICKET_RECTS, TICKET_SLOTS, TICKET_WORDS, type TicketSlot } from "@/lib/ticket-layout";

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

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Shrinks text so it fits a blank of the given width (points); keeps the base size when it already fits. */
function fit(text: string, width: number, base: number, min = 5.5, em = 0.7): number {
  if (!text) return base;
  return Math.max(min, Math.min(base, width / (text.length * em)));
}

function slotStyle(slot: TicketSlot, size: number, align: CSSProperties["textAlign"] = "left"): CSSProperties {
  return { left: `${slot.x}pt`, top: `${slot.y}pt`, width: `${slot.x2 - slot.x}pt`, height: `${slot.h}pt`, lineHeight: `${slot.h}pt`, fontSize: `${size}pt`, textAlign: align };
}

// The ticket reproduces the owner's pre-printed form (half-letter, landscape).
// Everything static (wording, boxes, signature lines) comes from lib/ticket-layout.ts,
// which is read straight out of the owner's PDF, so positions match it exactly.
// Only the blanks are filled with loan data.
export function PawnTicketForm(p: PawnTicketProps) {
  const [name, address, words, amount, rate, appraised] = TICKET_SLOTS;
  const wordsText = pesoWords(p.principal);
  const [loanDate, maturity, expiry] = TICKET_FIELDS;
  const dateAt = (f: (typeof TICKET_FIELDS)[number], text: string) => (
    <span className="pf-montserrat" style={{ left: `${f.x}pt`, top: `${f.y}pt`, fontSize: `${f.s}pt`, lineHeight: `${f.h}pt`, fontWeight: 700 }}>
      {text}
    </span>
  );
  // the four value cells sit right of the peso signs in the table
  const rows = TICKET_WORDS.filter((w) => w.t === "₱" && w.x > 430 && w.x < 440).sort((a, b) => a.y - b.y);
  const tableValues = [p.principal, p.interest, p.serviceCharge, p.principal - p.serviceCharge];
  const d = p.description;
  const descSize = d.length <= 90 ? 10 : d.length <= 200 ? 8.5 : d.length <= 320 ? 7.5 : 6.5;

  return (
    <article className="pawn-form">
      {TICKET_RECTS.map((r, i) =>
        r.h === 0 ? (
          <div key={i} style={{ left: `${r.x}pt`, top: `${r.y}pt`, width: `${r.w}pt`, height: `${r.lw}pt`, background: "#000" }} />
        ) : (
          <div
            key={i}
            style={{ left: `${r.x}pt`, top: `${r.y}pt`, width: `${r.w}pt`, height: `${r.h}pt`, border: `${r.lw}pt solid #000`, boxSizing: "border-box" }}
          />
        ),
      )}

      {TICKET_WORDS.map((w, i) => (
        <span
          key={i}
          className={w.f === "poppins" ? "pf-poppins" : "pf-montserrat"}
          style={{ left: `${w.x}pt`, top: `${w.y}pt`, fontSize: `${w.s}pt`, lineHeight: `${w.h}pt`, fontWeight: w.w, fontStyle: w.i, letterSpacing: w.ls ? `${w.ls}pt` : undefined }}
        >
          {w.t}
        </span>
      ))}

      {/* ticket number, inside the NO box */}
      <span
        className="pf-montserrat pf-fill"
        style={{ left: "487pt", top: "37.14pt", width: "88pt", height: "14.8pt", lineHeight: "14.8pt", fontSize: `${fit(p.ticketNumber, 88, 12.13, 7, 0.78)}pt`, fontWeight: 700 }}
      >
        {p.ticketNumber}
      </span>

      {dateAt(loanDate, formatDate(p.loanDate))}
      {dateAt(maturity, formatDate(p.maturityDate))}
      {dateAt(expiry, formatDate(p.redemptionExpiry))}

      <span className="pf-montserrat pf-fill" style={slotStyle(name, fit(p.customerName, name.x2 - name.x, 10))}>
        {p.customerName}
      </span>
      <span className="pf-montserrat pf-fill" style={slotStyle(address, fit(p.address, address.x2 - address.x, 10))}>
        {p.address}
      </span>
      <span className="pf-montserrat pf-fill" style={slotStyle(words, fit(wordsText, words.x2 - words.x, 10, 5.5, 0.74))}>
        {wordsText}
      </span>
      <span className="pf-montserrat pf-fill" style={slotStyle(amount, fit(peso(p.principal), amount.x2 - amount.x, 10), "center")}>
        {peso(p.principal)}
      </span>
      <span className="pf-montserrat pf-fill" style={slotStyle(rate, 10, "center")}>
        {p.interestRatePercent}
      </span>
      <span className="pf-montserrat pf-fill" style={slotStyle(appraised, fit(p.appraised === null ? "" : peso(p.appraised), appraised.x2 - appraised.x, 10), "center")}>
        {p.appraised === null ? "" : peso(p.appraised)}
      </span>

      {/* description of the pawn: inside the left box */}
      <div
        className="pf-montserrat"
        style={{ left: "53pt", top: "264pt", width: "240pt", height: "66pt", overflow: "hidden", whiteSpace: "normal", fontSize: `${descSize}pt`, lineHeight: 1.3, fontWeight: 600, color: "#000" }}
      >
        {d}
      </div>

      {rows.map((r, i) => (
        <span
          key={i}
          className="pf-montserrat pf-fill"
          style={{ left: "449pt", top: `${r.y}pt`, width: "113pt", height: `${r.h}pt`, lineHeight: `${r.h}pt`, fontSize: `${fit(peso(tableValues[i]), 113, r.s, 6)}pt` }}
        >
          {peso(tableValues[i])}
        </span>
      ))}
    </article>
  );
}
