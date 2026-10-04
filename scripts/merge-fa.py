#!/usr/bin/env python3
"""Merge Persian translations from translate/ into data/fa/.

Reads translate/meta/out*.json (name, vibe, description) and translate/out/<id>.md
(translated prompt bodies with ⟦CODEn⟧ placeholders), puts the original code blocks
back, validates structure, and writes data/fa/meta.json plus one data/fa/<division>.json.
"""
import json, os, re, glob, sys
root = os.path.join(os.path.dirname(__file__), "..")
T = os.path.join(root, "translate"); OUT = os.path.join(root, "data", "fa")
agents = json.load(open(os.path.join(root, "data", "agents.json")))["agents"]
codes = json.load(open(os.path.join(T, "codes.json")))
os.makedirs(OUT, exist_ok=True)

meta = {}
for f in sorted(glob.glob(os.path.join(T, "meta", "out*.json"))):
    try:
        for o in json.load(open(f)):
            meta[o["id"]] = {"name": o["name"], "vibe": o.get("vibe", ""), "description": o["description"]}
    except Exception as e:
        print("bad meta", f, e)
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), ensure_ascii=False, separators=(",", ":"))

PH = re.compile(r"⟦CODE(\d+)⟧")
byDiv, bad, missing = {}, [], []
for a in agents:
    p = os.path.join(T, "out", a["id"] + ".md")
    if not os.path.exists(p):
        missing.append(a["id"]); continue
    txt = open(p, encoding="utf-8").read()
    src = open(os.path.join(T, "in", a["id"] + ".md"), encoding="utf-8").read()
    n = len(codes[a["id"]])
    found = sorted(int(x) for x in PH.findall(txt))
    h_src = len(re.findall(r"^#{1,6} ", src, re.M)); h_out = len(re.findall(r"^#{1,6} ", txt, re.M))
    ok = found == list(range(n)) and abs(h_src - h_out) <= max(1, h_src // 10) and len(txt) > 0.3 * len(src)
    if not ok:
        bad.append((a["id"], n, len(found), h_src, h_out, len(src), len(txt))); continue
    txt = PH.sub(lambda m: "\n" + codes[a["id"]][int(m.group(1))] + "\n", txt)
    byDiv.setdefault(a["division"], {})[a["id"]] = txt
for d, v in byDiv.items():
    json.dump(v, open(os.path.join(OUT, d + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"meta {len(meta)}/{len(agents)}, bodies {sum(len(v) for v in byDiv.values())}/{len(agents)}, missing {len(missing)}, invalid {len(bad)}")
for b in bad[:20]: print("invalid", b)
if len(sys.argv) > 1: print("missing:", missing)
