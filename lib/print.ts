// Item 15: thermal paper width. Change this one value to 58 for 58mm printers;
// it sets both the @page size and the --thermal-width CSS variable.
export const THERMAL_WIDTH_MM = 80;

/**
 * CSS @page cannot take "80mm auto", so the page height is the measured slip
 * height (set by the print toolbar once the slip has rendered). Until then a
 * long fallback keeps nothing from being cut off.
 */
export function thermalCss(widthMm: number = THERMAL_WIDTH_MM, heightMm?: number): string {
  const h = heightMm ? Math.ceil(heightMm) + 2 : 600;
  return `:root{--thermal-width:${widthMm}mm}@page{size:${widthMm}mm ${h}mm;margin:0;@bottom-right{content:none}}`;
}

export const MM_PER_CSS_PX = 25.4 / 96;
