const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const SCALES = ["", "THOUSAND", "MILLION", "BILLION"];

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], "HUNDRED");
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** Cheque-style amount in words for the pawn ticket, e.g. "TEN THOUSAND PESOS ONLY". */
export function pesoWords(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  let whole = Math.floor(cents / 100);
  const centavos = cents % 100;
  if (whole === 0 && centavos === 0) return "ZERO PESOS ONLY";

  const groups: string[] = [];
  for (let i = 0; whole > 0; i++, whole = Math.floor(whole / 1000)) {
    const chunk = whole % 1000;
    if (chunk) groups.unshift(`${underThousand(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
  }
  const pesos = groups.length ? `${groups.join(" ")} PESO${cents === 100 ? "" : "S"}` : "ZERO PESOS";
  const tail = centavos ? ` AND ${String(centavos).padStart(2, "0")}/100` : " ONLY";
  return `${pesos}${tail}`.trim();
}
