#!/usr/bin/env python3
"""Build data/agents.json from a checkout of msitarzewski/agency-agents.

Usage: python3 scripts/build-data.py /path/to/agency-agents
"""
import json
import os
import re
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "../agency-agents"
out = os.path.join(os.path.dirname(__file__), "..", "data", "agents.json")

divisions = json.load(open(os.path.join(src, "divisions.json")))["divisions"]
FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def parse(path):
    m = FM.match(open(path, encoding="utf-8").read())
    if not m:
        return None
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "\t", "-")):
            k, v = line.split(":", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            meta[k.strip()] = v
    if "name" not in meta:
        return None
    return meta, m.group(2).strip()


result = {"divisions": [], "agents": []}
for key, info in divisions.items():
    count = 0
    for root, _, files in sorted(os.walk(os.path.join(src, key))):
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            parsed = parse(os.path.join(root, f))
            if not parsed:
                continue
            meta, body = parsed
            rel = os.path.relpath(os.path.join(root, f), src)
            result["agents"].append({
                "id": rel[:-3].replace("/", "__"),
                "division": key,
                "name": meta["name"],
                "emoji": meta.get("emoji", "🤖"),
                "vibe": meta.get("vibe", ""),
                "description": meta.get("description", ""),
                "color": meta.get("color", ""),
                "path": rel,
                "body": body,
            })
            count += 1
    if count:
        result["divisions"].append({"key": key, **info, "count": count})

os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(result['agents'])} agents in {len(result['divisions'])} divisions -> {out}")
