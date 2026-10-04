'use strict';
(() => {
  // ---------- constants & helpers ----------
  const TW = 64, TH = 32, WALLH = 30;
  const REPO = 'https://github.com/msitarzewski/agency-agents/blob/main/';
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  const SKIN = ['#F6D2B8', '#EDB98F', '#D9A07A', '#B97D57', '#8D5A3B', '#6B4128', '#F2C9A0'];
  const HAIR = ['#2A1E17', '#4A2F1E', '#7A4A27', '#C98B3F', '#E3C27A', '#1C1C24', '#8E3B2C', '#9AA3AE', '#5B3A68'];
  const PANTS = ['#2E3A4F', '#3B3F4A', '#4A3C33', '#26344A', '#55606F', '#1F2633'];
  const DESK = '#E8DAC4', FLOOR_GROUND = '#E4EAEE', WALL = '#F3F5F7';
  const QUIPS = ['Shipping it 🚀', 'LGTM ✅', 'One more test…', 'In the zone 🎧', 'Standup in 5?',
    'Writing docs 📝', 'Inbox zero!', 'Pairing anyone?', 'Checking metrics 📈', 'Brainstorming 💡',
    'Deploying to staging', 'Who broke main?', 'Ticket closed 🎉', 'Need a review here'];
  const BREAK_LINES = { coffee: ['☕ Refuel time', 'Espresso, double.', 'Who took the oat milk?', 'Coffee #3 today'],
    cooler: ['💧 Hydrate', 'Did you see the roadmap?', 'Nice weather out', 'Stretch break'] };

  const pctx = document.createElement('canvas').getContext('2d');
  const rgbCache = new Map(), shadeCache = new Map();
  function rgb(col) {
    if (rgbCache.has(col)) return rgbCache.get(col);
    pctx.fillStyle = '#010203'; pctx.fillStyle = col;
    const v = pctx.fillStyle; let out = null;
    if (col && (v !== '#010203' || col === '#010203')) {
      out = v[0] === '#' ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : v.match(/[\d.]+/g).slice(0, 3).map(Number);
    }
    rgbCache.set(col, out); return out;
  }
  function shade(col, amt) {
    const k = col + '|' + amt; let s = shadeCache.get(k); if (s) return s;
    const c = rgb(col) || [128, 128, 128], t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    s = `rgb(${c.map((v) => Math.round(v + (t - v) * p)).join(',')})`;
    shadeCache.set(k, s); return s;
  }
  function mix(a, b, p) {
    const x = rgb(a) || [128, 128, 128], y = rgb(b);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(',')})`;
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  const pick = (arr, r = Math.random()) => arr[Math.floor(r * arr.length) % arr.length];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---------- isometric drawing primitives ----------
  function iso(x, y, z = 0) { return [(x - y) * TW / 2, (x + y) * TH / 2 - z]; }
  function poly(pts, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function box(x, y, w, d, z, h, base, top) {
    const a = iso(x, y + d, z), b = iso(x + w, y + d, z), c = iso(x + w, y, z);
    const a2 = iso(x, y + d, z + h), b2 = iso(x + w, y + d, z + h), c2 = iso(x + w, y, z + h), d2 = iso(x, y, z + h);
    poly([a, b, b2, a2], shade(base, -0.08));
    poly([b, c, c2, b2], shade(base, -0.22));
    poly([d2, c2, b2, a2], top || base);
  }
  function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }

  // ---------- world ----------
  let rooms = [], chars = [], statics = [], trees = [], world = { w: 0, d: 0 };
  let byId = new Map();

  function build(data) {
    rooms = data.divisions.map((dv, i) => {
      const agents = data.agents.filter((a) => a.division === dv.key);
      const n = agents.length;
      const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.4)));
      const rows = Math.ceil(n / cols);
      return { i, dv, color: dv.color, agents, cols, rows, W: 2 * cols + 3, D: 3 * rows + 2, chars: [] };
    });

    // shelf-pack rooms into a roughly square campus
    const area = rooms.reduce((s, r) => s + (r.W + 3) * (r.D + 3), 0);
    const maxW = Math.max(30, Math.sqrt(area) * 1.1);
    const order = [...rooms].sort((a, b) => b.D - a.D || b.W - a.W);
    const GAP = 3; let x = 0, y = 0, sd = 0, mw = 0;
    for (const r of order) {
      if (x > 0 && x + r.W > maxW) { x = 0; y += sd + GAP; sd = 0; }
      r.x = x; r.y = y; x += r.W + GAP; sd = Math.max(sd, r.D); mw = Math.max(mw, x - GAP);
    }
    world = { w: mw, d: y + sd };

    for (const r of rooms) {
      const { x: L, y: T, W, D, color } = r;
      // back walls (cut-away front)
      for (let i = 0; i < W; i++) statics.push({ key: L + i + 0.5 + T - 0.3, x: L + i + 0.5, y: T, draw: () => wallX(L + i, T, color) });
      for (let j = 0; j < D; j++) statics.push({ key: L - 0.3 + T + j + 0.5, x: L, y: T + j + 0.5, draw: () => wallY(L, T + j, color) });
      // amenities
      const cx = L + W - 1.6, cy = T + 0.12;
      statics.push({ key: cx + cy + 0.9, x: cx, y: cy, draw: (t) => coffee(cx, cy, color, t) });
      const wx = L + W - 0.78, wy = T + 3.35;
      statics.push({ key: wx + wy + 0.5, x: wx, y: wy, draw: () => cooler(wx, wy) });
      statics.push({ key: L + 0.5 + T + D - 0.5, x: L + 0.5, y: T + D - 0.5, draw: (t) => plant(L + 0.5, T + D - 0.55, t, 1) });
      statics.push({ key: L + W - 0.5 + T + D - 0.5, x: L + W - 0.5, y: T + D - 0.5, draw: (t) => plant(L + W - 0.5, T + D - 0.55, t, 2) });

      r.agents.forEach((a, k) => {
        const col = k % r.cols, row = Math.floor(k / r.cols);
        const dx = L + 1.5 + 2 * col, ry = T + 3 * row + 2;
        const R = rng(hash(a.id));
        const deco = Math.floor(R() * 4);
        statics.push({ key: dx + ry + 0.1, x: dx, y: ry, draw: () => chair(dx, ry + 0.15, color) });
        const c = {
          a, room: r, seat: [dx, ry + 0.15], seatAisle: T + 3 * row + 1,
          x: dx, y: ry + 0.15, aisle: T + 3 * row + 1,
          state: 'work', timer: 3 + R() * 20, path: [], next: null, with: null,
          front: true, right: false, ph: R() * 6, seed: R() * 100,
          skin: pick(SKIN, R()), hair: pick(HAIR, R()), style: Math.floor(R() * 6), pants: pick(PANTS, R()),
          shirt: rgb(a.color) ? mix(a.color, '#7D8899', 0.28) : color,
          blink: R() * 4, bubble: null, bt: 0, reply: 0, sx: 0, sy: 0,
        };
        statics.push({ key: dx + ry + 0.8, x: dx, y: ry, draw: (t) => desk(dx, ry, color, deco, c, t) });
        chars.push(c); r.chars.push(c); byId.set(a.id, c);
      });
    }

    // trees on open ground around the campus
    const R = rng(7);
    const free = (x, y) => rooms.every((r) => x < r.x - 1.2 || x > r.x + r.W + 0.6 || y < r.y - 1.2 || y > r.y + r.D + 0.6);
    for (let k = 0; k < 400 && trees.length < 46; k++) {
      const tx = -3 + R() * (world.w + 6), ty = -3 + R() * (world.d + 6);
      if (free(tx, ty) && trees.every((t) => Math.hypot(t.x - tx, t.y - ty) > 2.2)) {
        const tr = { x: tx, y: ty, s: 0.8 + R() * 0.5, seed: R() * 10 };
        trees.push(tr);
        statics.push({ key: tx + ty, x: tx, y: ty, draw: (t) => tree(tr, t) });
      }
    }
  }

  // ---------- props ----------
  function wallX(x, y, color) {
    box(x, y - 0.18, 1, 0.18, 0, WALLH, WALL, shade(color, -0.1));
    const a = iso(x, y, 7), b = iso(x + 1, y, 7), b2 = iso(x + 1, y, 11), a2 = iso(x, y, 11);
    poly([a, b, b2, a2], shade(color, 0.35));
  }
  function wallY(x, y, color) {
    box(x - 0.18, y, 0.18, 1, 0, WALLH, WALL, shade(color, -0.1));
    const a = iso(x, y + 1, 7), b = iso(x, y, 7), b2 = iso(x, y, 11), a2 = iso(x, y + 1, 11);
    poly([a, b, b2, a2], shade(color, 0.35));
  }
  function chair(x, y, color) {
    const c = shade(color, -0.35);
    box(x - 0.27, y - 0.32, 0.54, 0.1, 9, 14, c);
    box(x - 0.05, y - 0.05, 0.1, 0.1, 0, 8, '#5A6474');
    box(x - 0.27, y - 0.22, 0.54, 0.44, 8, 3, c, shade(color, -0.2));
  }
  function desk(dx, ry, color, deco, c, t) {
    box(dx - 0.62, ry + 0.45, 1.24, 0.62, 0, 15, DESK, '#F1E7D6');
    box(dx - 0.24, ry + 0.52, 0.48, 0.3, 15, 1.4, '#C6CDD6');
    const lid = [iso(dx - 0.24, ry + 0.82, 16.4), iso(dx + 0.24, ry + 0.82, 16.4), iso(dx + 0.24, ry + 0.87, 27.5), iso(dx - 0.24, ry + 0.87, 27.5)];
    poly(lid, '#A9B2BE');
    const [lx, ly] = iso(dx, ry + 0.845, 22);
    const on = c.state === 'work';
    ctx.globalAlpha = on ? 0.65 + Math.sin(t * 2 + c.seed) * 0.25 : 0.25;
    circle(lx, ly, 2.2, color);
    ctx.globalAlpha = 1;
    if (deco === 1) box(dx + 0.36, ry + 0.78, 0.14, 0.14, 15, 6, shade(color, 0.1));
    else if (deco === 2) { box(dx - 0.52, ry + 0.62, 0.2, 0.28, 15, 2.5, '#FAFAF7'); }
    else if (deco === 3) { box(dx + 0.34, ry + 0.6, 0.16, 0.16, 15, 4, '#B36A3C'); const [px, py] = iso(dx + 0.42, ry + 0.68, 22); circle(px, py, 4, '#4E9A5B'); }
  }
  function coffee(x, y, color, t) {
    box(x, y, 1.1, 0.6, 0, 14, '#D9D2C6', '#EDE7DC');
    box(x + 0.2, y + 0.05, 0.45, 0.4, 14, 13, '#3A4250');
    const [lx, ly] = iso(x + 0.42, y + 0.45, 22);
    circle(lx, ly, 1.6, Math.sin(t * 3) > 0 ? '#E5484D' : '#7E2A2D');
    if (!reduce) {
      ctx.globalAlpha = 0.35;
      for (let k = 0; k < 2; k++) {
        const ph = (t * 0.6 + k * 0.5) % 1;
        const [sx, sy] = iso(x + 0.8, y + 0.3, 16 + ph * 16);
        circle(sx + Math.sin(ph * 6 + k) * 2, sy, 2 + ph * 2, '#FFFFFF');
      }
      ctx.globalAlpha = 1;
    }
    box(x + 0.75, y + 0.2, 0.12, 0.12, 14, 4, shade(color, 0.2));
  }
  function cooler(x, y) {
    box(x, y, 0.5, 0.5, 0, 18, '#E9EDF1');
    box(x + 0.08, y + 0.08, 0.34, 0.34, 18, 12, '#8CC4EA', '#B7DCF3');
  }
  function plant(x, y, t, v) {
    box(x - 0.2, y - 0.2, 0.4, 0.4, 0, 9, v === 1 ? '#C77C4B' : '#D9D2C6');
    const [px, py] = iso(x, y, 9);
    const sw = reduce ? 0 : Math.sin(t * 1.2 + x) * 1.5;
    ctx.fillStyle = '#3F8F57';
    for (let k = 0; k < 5; k++) {
      const ang = -Math.PI / 2 + (k - 2) * 0.45;
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(ang) * 6 + sw * (k / 4), py - 7 + Math.sin(ang) * 6, 3, 8, ang + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    circle(px + sw, py - 13, 4, '#57A96E');
  }
  function tree(tr, t) {
    const { x, y, s, seed } = tr;
    box(x - 0.08, y - 0.08, 0.16, 0.16, 0, 16 * s, '#8A6446');
    const [px, py] = iso(x, y, 16 * s);
    const sw = reduce ? 0 : Math.sin(t * 0.9 + seed) * 1.2;
    ctx.fillStyle = 'rgba(28,37,50,.1)';
    const [gx, gy] = iso(x, y); ctx.beginPath(); ctx.ellipse(gx, gy, 18 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
    circle(px + sw, py - 6 * s, 15 * s, '#4C9A63');
    circle(px - 6 * s + sw, py - 2 * s, 10 * s, '#438A58');
    circle(px + 4 * s + sw * 1.3, py - 14 * s, 9 * s, '#68B37C');
  }

  // ---------- characters ----------
  function drawChar(c, t) {
    const [sx, sy] = iso(c.x, c.y);
    const dim = filterSet && !filterSet.has(c);
    ctx.save(); ctx.translate(sx, sy);
    if (dim) ctx.globalAlpha = 0.2;
    const seated = c.state === 'work', walking = c.state === 'walk';
    if (c === selected || c === hover) {
      ctx.beginPath(); ctx.ellipse(0, 0, 13 + (c === selected && !reduce ? Math.sin(t * 4) * 2 : 0), 6.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = c.room.color; ctx.lineWidth = 2.2; ctx.stroke();
    }
    if (!seated) { ctx.fillStyle = 'rgba(28,37,50,.16)'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    const s = walking ? Math.sin(c.ph) : 0;
    const bob = reduce ? 0 : walking ? Math.abs(s) * 1.5 : Math.sin(t * 1.4 + c.seed) * 0.45;
    ctx.scale(c.right ? 1 : -1, 1);

    if (!seated) {
      const l1 = Math.max(0, s) * 2.5, l2 = Math.max(0, -s) * 2.5;
      ctx.fillStyle = c.pants;
      ctx.fillRect(-4.6, -11 - bob, 3.8, 10 + bob - l1);
      ctx.fillRect(0.8, -11 - bob, 3.8, 10 + bob - l2);
      ctx.fillStyle = '#262B35';
      ctx.fillRect(-5, -2.2 - l1, 4.6, 2.2); ctx.fillRect(0.4, -2.2 - l2, 4.6, 2.2);
    }
    const ty = -24 - bob;
    const arm = shade(c.shirt, -0.14);
    // back arm
    ctx.fillStyle = arm;
    if (seated) { const k = reduce ? 0 : Math.sin(t * 17 + c.seed) * 1.2; ctx.fillRect(-8.4, ty + 4, 3, 8 + k); circle(-6.9, ty + 12.5 + k, 1.8, c.skin); }
    else { ctx.fillRect(-8.6, ty + 3 - s * 1.5, 3, 9); circle(-7.1, ty + 12.5 - s * 1.5, 1.8, c.skin); }
    rr(-6.8, ty, 13.6, 14.5, 4.5, c.shirt);
    if (c.front) { ctx.fillStyle = c.room.color; ctx.fillRect(1.6, ty + 6, 3.2, 4); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(2.2, ty + 6.8, 2, 0.9); }
    ctx.fillStyle = arm;
    if (seated) { const k = reduce ? 0 : Math.sin(t * 19 + c.seed + 1) * 1.2; ctx.fillRect(5.4, ty + 4, 3, 8 + k); circle(6.9, ty + 12.5 + k, 1.8, c.skin); }
    else { ctx.fillRect(5.6, ty + 3 + s * 1.5, 3, 9); circle(7.1, ty + 12.5 + s * 1.5, 1.8, c.skin); }

    const hy = ty - 6.4;
    circle(0, hy, 7, c.skin);
    hair(c, hy);
    if (c.front) {
      const bl = c.blink < 0 ? 0.6 : 2.2;
      ctx.fillStyle = '#1C2532';
      ctx.fillRect(0.4, hy - 0.4, 1.6, bl); ctx.fillRect(3.8, hy - 0.4, 1.6, bl);
      ctx.fillStyle = 'rgba(232,110,110,.35)';
      circle(5.4, hy + 2.8, 1.3, 'rgba(232,110,110,.35)');
      if (c.bubble || c.state === 'stay') { ctx.fillStyle = '#7A3B32'; ctx.fillRect(2.2, hy + 3.4, 2.2, 1.1); }
    }
    ctx.restore();
    c.sx = sx; c.sy = sy;
  }
  function hair(c, hy) {
    const col = c.hair, f = c.front;
    ctx.fillStyle = col;
    if (c.style === 4) { // cap in division color
      const cap = c.room.color;
      ctx.beginPath(); ctx.arc(0, hy - 0.6, 7.5, Math.PI, 0); ctx.fillStyle = cap; ctx.fill();
      if (f) { ctx.fillRect(1, hy - 1.6, 8.5, 2); } else { ctx.beginPath(); ctx.arc(0, hy, 7.2, 0, Math.PI); ctx.fillStyle = col; ctx.fill(); }
      return;
    }
    if (!f) {
      circle(0, hy, 7.4, col);
      if (c.style === 2) rr(-7.4, hy, 14.8, 10, 3, col);
      if (c.style === 1) circle(0, hy - 8, 3.6, col);
      return;
    }
    ctx.beginPath(); ctx.arc(0, hy - 0.4, 7.5, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-7.5, hy - 1, 3.4, 5);
    if (c.style === 1) circle(-2, hy - 8.4, 3.6, col);
    else if (c.style === 2) rr(-7.8, hy - 1, 4.6, 12, 2, col);
    else if (c.style === 3) {
      for (let k = 0; k < 4; k++) { const bx = -6 + k * 3.8; ctx.beginPath(); ctx.moveTo(bx - 2.4, hy - 5); ctx.lineTo(bx, hy - 10.5); ctx.lineTo(bx + 2.4, hy - 5); ctx.fill(); }
    } else if (c.style === 5) {
      for (let k = 0; k < 5; k++) circle(-6 + k * 3, hy - 6 + Math.abs(k - 2) * 0.8, 2.8, col);
    }
  }

  // ---------- behaviour ----------
  let bubbleCount = 0;
  function say(c, text, force) {
    if (!text) return;
    if (!force && bubbleCount > 16) return;
    if (!c.bubble) bubbleCount++;
    c.bubble = text; c.bt = 2.8 + Math.min(text.length, 90) * 0.04;
  }
  function workLine(c) {
    if (c.a.vibe && Math.random() < 0.55) return c.a.vibe;
    return pick(QUIPS);
  }
  function route(c, tx, ty, ta) {
    const r = c.room, p = [[c.x, c.aisle]];
    if (Math.abs(c.aisle - ta) > 0.01) {
      const lx = r.x + 0.5, rx = r.x + r.W - 2;
      const cx = Math.abs(c.x - lx) + Math.abs(tx - lx) < Math.abs(c.x - rx) + Math.abs(tx - rx) ? lx : rx;
      p.push([cx, c.aisle], [cx, ta]);
    }
    p.push([tx, ta], [tx, ty]);
    c.path = p; c.aisle = ta;
  }
  function leave(c) {
    const r = c.room, L = r.x, T = r.y, roll = Math.random();
    let tx, ty, ta, act = 'wander', other = null;
    if (roll < 0.22) { tx = L + r.W - 1.05 + (Math.random() - 0.5) * 0.4; ty = T + 1.2; ta = T + 1; act = 'coffee'; }
    else if (roll < 0.36) { tx = L + r.W - 1.45; ty = T + 3.6 + (Math.random() - 0.5) * 0.3; ta = ty; act = 'cooler'; }
    else if (roll < 0.72 && r.chars.length > 1) {
      other = pick(r.chars.filter((o) => o !== c && o.state === 'work')) || null;
      if (other) { tx = other.seat[0] + 1; ty = other.seat[1] + 0.05; ta = other.seatAisle; act = 'chat'; }
    }
    if (tx === undefined) {
      const j = Math.floor(Math.random() * (r.rows + 1));
      ta = T + 1 + 3 * j; ty = ta; tx = L + 1 + Math.random() * (r.W - 3.5);
    }
    route(c, tx, ty, ta);
    c.state = 'walk'; c.next = act; c.with = other;
  }
  function goBack(c) { route(c, c.seat[0], c.seat[1], c.seatAisle); c.state = 'walk'; c.next = 'sit'; }
  function arrive(c) {
    if (c.next === 'sit') { c.state = 'work'; c.front = true; c.right = false; c.timer = 10 + Math.random() * 28; return; }
    c.state = 'stay'; c.timer = 3.5 + Math.random() * 5;
    if (c.next === 'coffee') { c.front = false; c.right = true; say(c, pick(BREAK_LINES.coffee)); }
    else if (c.next === 'cooler') { c.front = true; c.right = true; say(c, pick(BREAK_LINES.cooler)); }
    else if (c.next === 'chat') {
      c.front = false; c.right = false; c.timer += 2;
      say(c, c.a.vibe && Math.random() < 0.5 ? c.a.vibe : pick(['Got a sec?', 'Quick sync?', 'Can you look at this?', 'Lunch later?', 'Nice work on that!']), true);
      if (c.with && c.with.state === 'work') c.with.reply = 1.8;
    } else { c.front = Math.random() < 0.5; c.right = Math.random() < 0.5; }
  }
  function step(c, dt) {
    let rem = 1.7 * dt;
    while (rem > 0 && c.path.length) {
      const [px, py] = c.path[0], dx = px - c.x, dy = py - c.y, d = Math.hypot(dx, dy);
      if (d < 1e-4) { c.path.shift(); continue; }
      if (Math.abs(dx) > Math.abs(dy)) { c.front = dx > 0; c.right = dx > 0; } else { c.front = dy > 0; c.right = dy < 0; }
      const m = Math.min(rem, d); c.x += dx / d * m; c.y += dy / d * m; rem -= m;
      if (m === d) c.path.shift();
    }
    c.ph += dt * 11;
    if (!c.path.length) arrive(c);
  }
  function update(dt) {
    for (const c of chars) {
      c.blink -= dt; if (c.blink < -0.13) c.blink = 2 + Math.random() * 4;
      if (c.bubble) { c.bt -= dt; if (c.bt <= 0) { c.bubble = null; bubbleCount--; } }
      if (c.reply > 0) { c.reply -= dt; if (c.reply <= 0 && c.state === 'work') say(c, pick(['Sure, one sec', 'On it 👍', 'Ha, good one', 'Send me the link', 'After this commit']), true); }
      if (reduce) continue;
      if (c.state === 'work') {
        c.timer -= dt;
        if (!c.bubble && Math.random() < dt * 0.01) say(c, workLine(c));
        if (c.timer <= 0 && c !== selected) leave(c);
      } else if (c.state === 'walk') step(c, dt);
      else if (c.state === 'stay') { c.timer -= dt; if (c.timer <= 0) goBack(c); }
    }
  }

  // ---------- camera ----------
  let Wd = 0, Hd = 0, DPR = 1;
  const cam = { x: 0, y: 0, z: 1 };
  let flight = null, follow = null;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    Wd = r.width; Hd = r.height;
    canvas.width = Math.round(Wd * DPR); canvas.height = Math.round(Hd * DPR);
  }
  const zmin = () => 0.12, zmax = () => 3.2;
  function boundsOf(x, y, w, d) {
    const pts = [iso(x, y, WALLH + 30), iso(x + w, y), iso(x + w, y + d), iso(x, y + d), iso(x + w, y, WALLH + 30), iso(x, y + d, WALLH + 30)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  function fitTo(b, pad = 60, minZ = 0) {
    const leftUI = Wd > 720 ? 330 : 0;
    const availW = Wd - leftUI - pad * 2, availH = Hd - pad * 2 - (Wd > 720 ? 0 : 160);
    const z = clamp(Math.max(minZ, Math.min(availW / (b.x1 - b.x0), availH / (b.y1 - b.y0))), zmin(), 1.9);
    const cx = (b.x0 + b.x1) / 2 - leftUI / 2 / z, cy = (b.y0 + b.y1) / 2 + (Wd > 720 ? 0 : -40 / z);
    return { x: cx, y: cy, z };
  }
  function flyTo(target, dur = 1.1) {
    if (reduce) { Object.assign(cam, target); flight = null; return; }
    flight = { from: { ...cam }, to: target, t: 0, dur };
  }
  function zoomAt(sx, sy, nz) {
    nz = clamp(nz, zmin(), zmax());
    const wx = cam.x + (sx - Wd / 2) / cam.z, wy = cam.y + (sy - Hd / 2) / cam.z;
    cam.z = nz; cam.x = wx - (sx - Wd / 2) / nz; cam.y = wy - (sy - Hd / 2) / nz;
    flight = null;
  }
  const toScreen = (ix, iy) => [(ix - cam.x) * cam.z + Wd / 2, (iy - cam.y) * cam.z + Hd / 2];

  // ---------- render ----------
  let hitList = [];
  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const z = cam.z * DPR;
    ctx.setTransform(z, 0, 0, z, DPR * (Wd / 2 - cam.x * cam.z), DPR * (Hd / 2 - cam.y * cam.z));
    const vx0 = cam.x - Wd / 2 / cam.z - 80, vx1 = cam.x + Wd / 2 / cam.z + 80;
    const vy0 = cam.y - Hd / 2 / cam.z - 60, vy1 = cam.y + Hd / 2 / cam.z + 120;
    const visible = (x, y) => { const [ix, iy] = iso(x, y); return ix > vx0 && ix < vx1 && iy > vy0 && iy < vy1; };

    // ground slab
    const m = 4;
    box(-m, -m, world.w + 2 * m, world.d + 2 * m, -22, 22, '#CBD5DC', FLOOR_GROUND);
    // room floors
    ctx.lineWidth = 1;
    for (const r of rooms) {
      const { x, y, W, D, color } = r;
      poly([iso(x, y), iso(x + W, y), iso(x + W, y + D), iso(x, y + D)], shade(color, 0.72));
      poly([iso(x + 0.3, y + 0.3), iso(x + W - 0.3, y + 0.3), iso(x + W - 0.3, y + D - 0.3), iso(x + 0.3, y + D - 0.3)], shade(color, 0.84));
      if (cam.z > 0.35) {
        ctx.beginPath();
        for (let i = 1; i < W; i++) { const a = iso(x + i, y + 0.3), b = iso(x + i, y + D - 0.3); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        for (let j = 1; j < D; j++) { const a = iso(x + 0.3, y + j), b = iso(x + W - 0.3, y + j); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.strokeStyle = shade(color, 0.76); ctx.stroke();
      }
    }
    // depth-sorted scene
    const list = [];
    for (const s of statics) if (visible(s.x, s.y)) list.push(s);
    for (const c of chars) if (visible(c.x, c.y)) list.push({ key: c.x + c.y, c });
    list.sort((a, b) => a.key - b.key);
    hitList = [];
    for (const it of list) {
      if (it.c) { drawChar(it.c, t); hitList.push(it.c); } else it.draw(t);
    }

    // screen-space overlays
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const placed = [];
    for (const r of rooms) {
      const [ix, iy] = iso(r.x + r.W / 2, r.y, WALLH + 22);
      const [sx, sy] = toScreen(ix, iy);
      if (sx < -200 || sx > Wd + 200 || sy < -40 || sy > Hd + 40) continue;
      const size = cam.z < 0.3 ? 11 : 13, half = (r.dv.label.length * size * 0.32 + 26);
      if (placed.some((p) => Math.abs(p[0] - sx) < p[2] + half && Math.abs(p[1] - sy) < size + 12)) continue;
      placed.push([sx, sy, half]);
      label(sx, sy, r.dv.label, r.agents.length, r.color, size);
    }
    if (cam.z > 0.5) {
      for (const c of hitList) if (c.bubble && (!filterSet || filterSet.has(c))) bubble(c);
    }
    const tag = selected || hover;
    if (tag && hitList.includes(tag)) nameTag(tag);
    if (hover && hover !== selected && hitList.includes(hover) && selected && hitList.includes(selected)) nameTag(hover);
  }
  function label(x, y, text, n, color, size) {
    ctx.font = `700 ${size}px "Bricolage Grotesque", "Trebuchet MS", sans-serif`;
    const num = String(n);
    const w = ctx.measureText(text).width;
    ctx.font = `500 ${size - 2}px "JetBrains Mono", monospace`;
    const nw = ctx.measureText(num).width;
    const W = w + nw + 32, H = size + 12;
    rr(x - W / 2, y - H / 2, W, H, H / 2, '#1C2532');
    circle(x - W / 2 + 11, y, 4, color);
    ctx.fillStyle = '#F9FBFC'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px "Bricolage Grotesque", "Trebuchet MS", sans-serif`;
    ctx.fillText(text, x - W / 2 + 20, y + 0.5);
    ctx.fillStyle = '#9FB0C2';
    ctx.font = `500 ${size - 2}px "JetBrains Mono", monospace`;
    ctx.fillText(num, x - W / 2 + 26 + w, y + 0.5);
  }
  function headScreen(c) {
    const [ix, iy] = iso(c.x, c.y);
    const [sx, sy] = toScreen(ix, iy);
    return [sx, sy - 40 * cam.z];
  }
  function wrap(text, maxW, maxLines) {
    const words = text.split(/\s+/), lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    const used = lines.join(' ').length;
    if (used < text.length - 1) lines[lines.length - 1] = lines[lines.length - 1].replace(/[\s,.;:—-]*\S{0,3}$/, '') + '…';
    return lines;
  }
  function bubble(c) {
    const [x, y] = headScreen(c);
    ctx.font = '500 12px "Figtree", system-ui, sans-serif';
    const lines = wrap(c.bubble, 170, 3);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, h = lines.length * 16 + 10;
    const bx = x - w / 2, by = y - h - 12;
    const a = Math.min(1, c.bt * 2);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(28,37,50,.12)'; ctx.beginPath(); ctx.roundRect(bx + 1, by + 2, w, h, 9); ctx.fill();
    rr(bx, by, w, h, 9, '#FFFFFF');
    ctx.beginPath(); ctx.moveTo(x - 5, by + h); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 5, by + h); ctx.fill();
    ctx.fillStyle = '#1C2532'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 6 + i * 16));
    ctx.globalAlpha = 1;
  }
  function nameTag(c) {
    const [x, y0] = headScreen(c);
    const y = y0 - (c.bubble && cam.z > 0.5 ? 0 : 0) + 4;
    ctx.font = '600 13px "Figtree", system-ui, sans-serif';
    const text = `${c.a.emoji} ${c.a.name}`;
    const w = ctx.measureText(text).width + 20;
    const by = c.bubble && cam.z > 0.5 ? y + 34 * cam.z + 18 : y - 30;
    rr(x - w / 2, by, w, 24, 12, c.room.color);
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x - w / 2 + 10, by + 12.5);
  }

  // ---------- interaction ----------
  let selected = null, hover = null, filterSet = null;
  function hitTest(sx, sy) {
    for (let i = hitList.length - 1; i >= 0; i--) {
      const c = hitList[i];
      const [px, py] = toScreen(c.sx, c.sy);
      const hw = 11 * cam.z, top = py - 40 * cam.z;
      if (sx > px - hw && sx < px + hw && sy > top && sy < py + 4 * cam.z) return c;
    }
    return null;
  }
  const pointers = new Map(); let drag = null, pinch = null, moved = false;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = local(e); pointers.set(e.pointerId, { x, y });
    if (pointers.size === 1) { drag = { x, y, cx: cam.x, cy: cam.y }; moved = false; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z }; drag = null; moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
      return;
    }
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (!moved && Math.hypot(dx, dy) > 5) { moved = true; canvas.classList.add('dragging'); follow = null; updateFollowBtn(); }
      if (moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; flight = null; }
      return;
    }
    if (e.pointerType === 'mouse') {
      hover = hitTest(x, y);
      canvas.classList.toggle('pointing', !!hover);
    }
  });
  const endPointer = (e) => {
    const [x, y] = local(e);
    if (drag && !moved && pointers.size === 1) { const c = hitTest(x, y); if (c) select(c); }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; canvas.classList.remove('dragging'); }
    else { const p = [...pointers.values()][0]; drag = { x: p.x, y: p.y, cx: cam.x, cy: cam.y }; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(x, y, cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  $('zin').onclick = () => flyTo({ ...cam, z: clamp(cam.z * 1.5, zmin(), zmax()) }, 0.35);
  $('zout').onclick = () => flyTo({ ...cam, z: clamp(cam.z / 1.5, zmin(), zmax()) }, 0.35);
  $('fit').onclick = () => { follow = null; updateFollowBtn(); flyTo(fitTo(boundsOf(-2, -2, world.w + 4, world.d + 4), 20)); };
  $('rnd').onclick = () => select(pick(chars));

  // ---------- dossier ----------
  const drawer = $('drawer');
  function select(c) {
    selected = c; follow = c; updateFollowBtn();
    const a = c.a, dv = c.room.dv;
    $('d-emoji').textContent = a.emoji;
    $('d-emoji').style.background = shade(dv.color, 0.8);
    $('d-name').textContent = a.name;
    $('d-div').innerHTML = '';
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = dv.color; dot.style.marginRight = '0';
    $('d-div').append(dot, document.createTextNode(dv.label));
    $('d-vibe').textContent = a.vibe || '';
    $('d-vibe').hidden = !a.vibe;
    $('d-desc').textContent = a.description;
    $('d-src').href = REPO + a.path.split('/').map(encodeURIComponent).join('/');
    const md = $('d-md');
    if (window.marked && window.DOMPurify) md.innerHTML = DOMPurify.sanitize(marked.parse(a.body));
    else { md.innerHTML = ''; const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = a.body; md.append(pre); }
    md.querySelectorAll('a').forEach((l) => { l.target = '_blank'; l.rel = 'noopener'; });
    drawer.querySelector('.dbody').scrollTop = 0;
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    if (c.state === 'work') say(c, `Hi! 👋 ${a.emoji}`, true);
    try { history.replaceState(null, '', '#' + a.id); } catch (_) { /* sandboxed */ }
    const [ix, iy] = iso(c.x, c.y);
    const z = Math.max(cam.z, 1.5);
    const offX = Wd > 720 ? 230 / z : 0, offY = Wd > 720 ? 20 / z : Hd * 0.27 / z;
    flyTo({ x: ix + offX, y: iy - offY, z }, 0.9);
  }
  function closeDrawer() {
    selected = null; follow = null;
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* sandboxed */ }
  }
  function updateFollowBtn() { $('d-follow').textContent = follow ? 'Stop following' : 'Follow on the floor'; }
  $('d-close').onclick = closeDrawer;
  $('d-follow').onclick = () => { follow = follow ? null : selected; updateFollowBtn(); };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (document.activeElement === q && q.value) { q.value = ''; runSearch(); } else closeDrawer(); }
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });

  // ---------- directory & search ----------
  const list = $('list'), q = $('q'), hud = $('hud');
  function renderDivisions() {
    list.innerHTML = '';
    for (const r of rooms) {
      const b = document.createElement('button');
      b.setAttribute('role', 'listitem');
      b.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="n"></span>';
      b.querySelector('.sw').style.background = r.color;
      b.querySelector('.nm').textContent = r.dv.label;
      b.querySelector('.n').textContent = r.agents.length;
      b.onclick = () => { follow = null; updateFollowBtn(); flyTo(fitTo(boundsOf(r.x, r.y, r.W, r.D), 60, 0.42)); if (Wd <= 720) setExpanded(false); };
      list.append(b);
    }
  }
  function runSearch() {
    const s = q.value.trim().toLowerCase();
    hud.classList.toggle('searching', s.length > 1);
    if (s.length < 2) { filterSet = null; renderDivisions(); return; }
    const res = s.split(/\s+/).map((t) => new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    const scored = [];
    for (const c of chars) {
      const a = c.a, name = a.name.toLowerCase();
      const hay = `${name} ${a.description} ${a.vibe} ${c.room.dv.label}`.toLowerCase();
      if (!res.every((re) => re.test(hay))) continue;
      scored.push([res.every((re) => re.test(name)) ? 0 : 1, c]);
    }
    scored.sort((x, y) => x[0] - y[0] || x[1].a.name.localeCompare(y[1].a.name));
    filterSet = new Set(scored.map((x) => x[1]));
    list.innerHTML = '';
    if (!scored.length) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = `No agent matches “${q.value.trim()}”. Try a skill like “seo” or “unity”.`; list.append(p); return; }
    for (const [, c] of scored.slice(0, 60)) {
      const b = document.createElement('button');
      b.setAttribute('role', 'listitem');
      b.innerHTML = '<span class="em"></span><span class="nm"><span></span><small></small></span><span class="sw"></span>';
      b.querySelector('.em').textContent = c.a.emoji;
      b.querySelector('.nm span').textContent = c.a.name;
      b.querySelector('.nm small').textContent = c.room.dv.label;
      b.querySelector('.sw').style.background = c.room.color;
      b.onclick = () => select(c);
      list.append(b);
    }
  }
  q.addEventListener('input', runSearch);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = list.querySelector('button'); if (first && filterSet) first.click(); } });
  function setExpanded(v) { hud.classList.toggle('expanded', v); $('toggle').setAttribute('aria-expanded', String(v)); $('toggle').textContent = v ? 'Hide' : 'Divisions'; }
  $('toggle').onclick = () => setExpanded(!hud.classList.contains('expanded'));

  // ---------- stats ----------
  function stats() {
    let w = 0, k = 0, ch = 0, br = 0;
    for (const c of chars) {
      if (c.state === 'work') w++;
      else if (c.state === 'walk') k++;
      else if (c.next === 'chat') ch++;
      else br++;
    }
    $('s-work').textContent = w; $('s-walk').textContent = k; $('s-chat').textContent = ch; $('s-break').textContent = br;
  }

  // ---------- loop ----------
  let last = performance.now(), statT = 0;
  function frame(now) {
    const real = Math.min(0.25, (now - last) / 1000), dt = Math.min(0.05, real); last = now;
    const t = now / 1000;
    update(dt);
    if (flight) {
      flight.t += real / flight.dur;
      const k = ease(Math.min(1, flight.t));
      const f = flight.from, to = flight.to;
      // zoom interpolated geometrically so flights feel even
      cam.z = f.z * Math.pow(to.z / f.z, k);
      cam.x = f.x + (to.x - f.x) * k; cam.y = f.y + (to.y - f.y) * k;
      if (flight.t >= 1) flight = null;
    } else if (follow) {
      const [ix, iy] = iso(follow.x, follow.y);
      const offX = Wd > 720 ? 230 / cam.z : 0, offY = Wd > 720 ? 20 / cam.z : Hd * 0.27 / cam.z;
      const k = Math.min(1, dt * 3);
      cam.x += (ix + offX - cam.x) * k; cam.y += (iy - offY - cam.y) * k;
    }
    render(t);
    statT -= dt; if (statT <= 0) { stats(); statT = 0.5; }
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  resize();
  addEventListener('resize', resize);
  fetch('data/agents.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      build(data);
      $('sub').textContent = `${chars.length} specialists across ${rooms.length} divisions, at work right now.`;
      renderDivisions();
      $('loading').remove();
      Object.assign(cam, fitTo(boundsOf(-2, -2, world.w + 4, world.d + 4), 20));
      const deep = byId.get(decodeURIComponent(location.hash.slice(1)));
      if (deep) select(deep);
      else {
        const eng = rooms.find((r) => r.dv.key === 'engineering') || rooms[0];
        setTimeout(() => flyTo(fitTo(boundsOf(eng.x, eng.y, eng.W, eng.D), 60, 0.42), 2.4), 700);
      }
      requestAnimationFrame((n) => { last = n; frame(n); });
    })
    .catch((err) => { $('loading').textContent = `Could not load the agent roster (${err.message}). Reload the page to try again.`; });
})();
