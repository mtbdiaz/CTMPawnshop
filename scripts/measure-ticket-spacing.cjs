/* eslint-disable @typescript-eslint/no-require-imports */
// Measures each static word in the rendered blank ticket and prints
// {wordIndex: letterSpacingPt} for words whose width differs from the PDF.
// Usage: node scripts/measure-ticket-spacing.cjs <playwright-path> <blank.html> <layout.json>
const { chromium } = require(process.argv[2]);
const words = JSON.parse(require("fs").readFileSync(process.argv[4], "utf8"));
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await b.newPage();
  await p.goto("file://" + process.argv[3]);
  await p.evaluate(async () => {
    await Promise.all(["300", "600", "700", "italic 600"].map((w) => document.fonts.load(w + " 10px Montserrat", "A")));
    await Promise.all(["300", "600"].map((w) => document.fonts.load(w + " 10px Poppins", "A")));
    await document.fonts.ready;
  });
  const widths = await p.evaluate(() => [...document.querySelectorAll(".pawn-form > span")].map((e) => e.getBoundingClientRect().width * 0.75));
  const out = {};
  words.forEach((w, i) => {
    const n = [...w.t].length;
    if (n < 2) return;
    const ls = (w.pw - widths[i]) / (n - 1);
    if (Math.abs(ls) > 0.04) out[i] = Math.round(ls * 1000) / 1000;
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
