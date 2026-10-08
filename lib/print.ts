// Item 15: thermal paper width. Change this one value to 58 for 58mm printers;
// it sets both the @page size and the --thermal-width CSS variable.
export const THERMAL_WIDTH_MM = 80;

export function thermalCss(widthMm: number = THERMAL_WIDTH_MM): string {
  return `:root{--thermal-width:${widthMm}mm}@page{size:${widthMm}mm auto;margin:0}@page{@bottom-right{content:none}}`;
}
