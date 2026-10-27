"""Measures how far each word of the rendered blank ticket sits from the owner's PDF
and prints/updates the per-word vertical correction.
Usage: python3 -I scripts/calibrate-ticket-y.py <owner.pdf> <blank-render.pdf> <y-adjust.json> [--update]"""
import json, os, re, sys, pymupdf
ref = pymupdf.open(sys.argv[1])[0]
mine = pymupdf.open(sys.argv[2])[0]
adj = json.load(open(sys.argv[3])) if os.path.exists(sys.argv[3]) else {}
src = open(os.path.join(os.path.dirname(__file__), "..", "lib", "ticket-layout.ts")).read()
layout = json.loads(re.search(r"TICKET_WORDS: TicketWord\[\] = (\[.*?\]);\n", src).group(1))
rw, mw = ref.get_text("words"), mine.get_text("words")
def near(words, text, x, y):
    c = [w for w in words if w[4] == text and abs(w[0] - x) < 2.5 and abs(w[1] - y) < 4]
    return min(c, key=lambda w: abs(w[0] - x) + abs(w[1] - y)) if c else None
new, worst = dict(adj), 0
for i, w in enumerate(layout):
    old = adj.get(str(i), 0)
    r = near(rw, w["t"], w["x"], w["y"] + old)
    m = near(mw, w["t"], w["x"], w["y"] + 0.0)
    if not r or not m: continue
    dy = m[1] - r[1]
    worst = max(worst, abs(dy))
    if abs(dy) > 0.15: new[str(i)] = round(old + dy, 2)
print("max |dy| before update:", round(worst, 2), " words adjusted:", len(new))
if "--update" in sys.argv: json.dump(new, open(sys.argv[3], "w"))
