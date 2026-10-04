# Agency HQ

An animated isometric office for **[The Agency](https://github.com/msitarzewski/agency-agents)**: every one of its 282 AI agents is a character at a desk inside their division's room.

- **18 rooms**, one per division, sized to the team and colored from `divisions.json`
- **Living characters**: they type at their laptops, walk to the coffee machine or water cooler, visit colleagues to chat, and show speech bubbles drawn from their own `vibe` line
- **Click any character** to open their profile: vibe, description, the full agent prompt rendered from Markdown, and a link to the source file
- **Search** by name or skill (`/` focuses the search box), jump to any division, or visit a random agent
- **Floor commands**: “All to desks” sends everyone back to their desk; “Free time” lets everyone loose. Press the active button again to return to the normal routine
- **English and Persian (فارسی)** interface with full right-to-left layout; switch with the language button, or open `index.html#fa`
- Drag to pan, scroll or pinch to zoom; works on phones; respects `prefers-reduced-motion`
- Deep links: `index.html#engineering__engineering-frontend-developer` opens that agent

No build step and no framework. It's a canvas 2D renderer in `app.js` plus a static data file.

## Run it

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Refresh the roster

`data/agents.json` is generated from a checkout of the agents repo:

```bash
git clone --depth 1 https://github.com/msitarzewski/agency-agents ../agency-agents
python3 scripts/build-data.py ../agency-agents
```

## Credits

Agent definitions © AgentLand Contributors, [MIT License](https://github.com/msitarzewski/agency-agents/blob/main/LICENSE).
