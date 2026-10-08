import { describe, expect, it } from "vitest";
import { THERMAL_WIDTH_MM, thermalCss } from "./print";

describe("thermal print css", () => {
  it("defaults to 80mm paper with a long fallback height", () => {
    expect(THERMAL_WIDTH_MM).toBe(80);
    expect(thermalCss()).toContain("size:80mm 600mm");
    expect(thermalCss()).toContain("--thermal-width:80mm");
  });
  it("switches to 58mm from one value", () => {
    expect(thermalCss(58)).toContain("size:58mm 600mm");
    expect(thermalCss(58)).toContain("--thermal-width:58mm");
  });
  it("fits the page to the measured slip", () => {
    expect(thermalCss(80, 151.2)).toContain("size:80mm 154mm");
  });
  it("never adds a page-number footer to slips", () => {
    expect(thermalCss()).toContain("@bottom-right{content:none}");
  });
});
