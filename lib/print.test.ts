import { describe, expect, it } from "vitest";
import { THERMAL_WIDTH_MM, thermalCss } from "./print";

describe("thermal print css", () => {
  it("defaults to 80mm paper", () => {
    expect(THERMAL_WIDTH_MM).toBe(80);
    expect(thermalCss()).toContain("size:80mm auto");
    expect(thermalCss()).toContain("--thermal-width:80mm");
  });
  it("switches to 58mm from one value", () => {
    expect(thermalCss(58)).toContain("size:58mm auto");
    expect(thermalCss(58)).toContain("--thermal-width:58mm");
  });
});
