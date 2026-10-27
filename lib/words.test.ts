import { describe, expect, it } from "vitest";
import { pesoWords } from "./words";

describe("pesoWords", () => {
  it("writes whole amounts", () => {
    expect(pesoWords(10000)).toBe("TEN THOUSAND PESOS ONLY");
    expect(pesoWords(1)).toBe("ONE PESO ONLY");
    expect(pesoWords(26000)).toBe("TWENTY-SIX THOUSAND PESOS ONLY");
    expect(pesoWords(115250)).toBe("ONE HUNDRED FIFTEEN THOUSAND TWO HUNDRED FIFTY PESOS ONLY");
  });
  it("writes centavos as a fraction", () => {
    expect(pesoWords(1500.5)).toBe("ONE THOUSAND FIVE HUNDRED PESOS AND 50/100");
    expect(pesoWords(0.05)).toBe("ZERO PESOS AND 05/100");
  });
  it("handles scale gaps and millions", () => {
    expect(pesoWords(1000000)).toBe("ONE MILLION PESOS ONLY");
    expect(pesoWords(1000100)).toBe("ONE MILLION ONE HUNDRED PESOS ONLY");
  });
  it("handles zero", () => expect(pesoWords(0)).toBe("ZERO PESOS ONLY"));
});
