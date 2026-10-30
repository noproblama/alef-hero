// Bake an Inkscape network drawing into svgnet_data.json.
//   node parse_svgnet.mjs [file.svg]      (default: drawing-mycelium.svg)
// Then: node inject_svgnet.mjs  → svgnet.js
//
// Output: { bbox, nodes:[[x,y,r]], paths:[{pts:[[x,y]], thick}], rings:[[x,y,r]] }
// All coordinates are in final visual (viewBox) space: group and element
// transforms are composed and applied. Closed near-perfect circles drawn as
// paths are the button rings — they go to `rings`, not `paths`.
import fs from 'fs';

const file = process.argv[2] || 'drawing-mycelium.svg';
const svg = fs.readFileSync(file, 'utf8');
const r1 = (x) => Math.round(x * 10) / 10;
const STEP = 2.4; // polyline sample spacing, in path-local units

// ── affine transforms: [a,b,c,d,e,f] → x' = a*x + c*y + e, y' = b*x + d*y + f ──
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function parseTransform(s) {
  let m = IDENT;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t;
    if (fn === 'matrix') t = a;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0], a[1] || 0];
    else if (fn === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else throw new Error(`unsupported transform: ${fn}`);
    m = mul(m, t);
  }
  return m;
}

// ── minimal tag walker (no deps): tracks the <g> transform/visibility stack ──
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const elements = []; // {tag, raw, m}
const stack = [{ m: IDENT, hidden: false, root: false }];
for (const t of svg.matchAll(/<(\/?)(\w+)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
  const [raw, close, name, , selfClose] = t;
  const top = stack[stack.length - 1];
  if (name === 'g') {
    if (close) { stack.pop(); continue; }
    const style = attr(raw, 'style') || '';
    stack.push({
      m: mul(top.m, parseTransform(attr(raw, 'transform'))),
      hidden: top.hidden || /display:\s*none/.test(style),
      // any group whose Inkscape label mentions "root" (e.g. "Thin roots")
      root: top.root || /root/i.test(attr(raw, 'inkscape:label') || ''),
    });
    if (selfClose) stack.pop();
    continue;
  }
  if (close || top.hidden) continue;
  if (name === 'path' || name === 'circle') {
    elements.push({ tag: name, raw, root: top.root, m: mul(top.m, parseTransform(attr(raw, 'transform'))) });
  }
}

// ── path sampler (M L H V C A Z, abs + rel) → local-space polylines ──
function arcToCenter(x1, y1, rx, ry, phiDeg, fa, fs_, x2, y2) {
  // SVG spec F.6.5 endpoint → centre parameterisation
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs_ ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs_ && dt > 0) dt -= 2 * Math.PI;
  if (fs_ && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, cos, sin, t1, dt };
}
function sample(d) {
  const t = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const polys = []; let cur = null;
  const num = () => parseFloat(t[i++]);
  const moveTo = (x, y) => { cur = [[x, y]]; polys.push(cur); cx = sx = x; cy = sy = y; };
  const lineTo = (x, y) => { if (!cur) moveTo(x, y); else { cur.push([x, y]); cx = x; cy = y; } };
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) cmd = t[i++];
    const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'M') { moveTo(num() + ox, num() + oy); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') lineTo(num() + ox, num() + oy);
    else if (C === 'H') lineTo(num() + ox, cy);
    else if (C === 'V') lineTo(cx, num() + oy);
    else if (C === 'C') {
      const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
      const p0x = cx, p0y = cy;
      const len = Math.hypot(x1 - p0x, y1 - p0y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);
      const n = Math.max(2, Math.round(len / STEP));
      for (let k = 1; k <= n; k++) {
        const u = k / n, m = 1 - u;
        cur.push([m * m * m * p0x + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x,
                  m * m * m * p0y + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y]);
      }
      cx = x; cy = y;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), fa = num(), fsw = num(), x = num() + ox, y = num() + oy;
      const a = arcToCenter(cx, cy, rx, ry, rot, fa, fsw, x, y);
      const n = Math.max(2, Math.round((Math.abs(a.dt) * Math.max(a.rx, a.ry)) / STEP));
      for (let k = 1; k <= n; k++) {
        const th = a.t1 + (a.dt * k) / n, ex = a.rx * Math.cos(th), ey = a.ry * Math.sin(th);
        cur.push([a.cos * ex - a.sin * ey + a.cx, a.sin * ex + a.cos * ey + a.cy]);
      }
      cx = x; cy = y;
    } else if (C === 'Z') {
      if (cur && (cx !== sx || cy !== sy)) cur.push([sx, sy]);
      cx = sx; cy = sy; cur = null;
    } else throw new Error(`unsupported path command "${cmd}" in ${file}`);
  }
  return polys;
}

// ── closed polyline with near-constant radius → button ring ──
function asRing(pts) {
  if (pts.length < 8) return null;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5) return null;
  // bbox centre, not point average — sampling density is uneven per segment
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = rs.reduce((s, v) => s + v, 0) / rs.length;
  const dev = Math.max(...rs.map((v) => Math.abs(v - r))) / r;
  return dev < 0.06 ? [cx, cy, r] : null;
}

const nodes = [], paths = [], rings = [];
for (const el of elements) {
  const { m } = el;
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  if (el.tag === 'circle') {
    const [x, y] = apply(m, +attr(el.raw, 'cx'), +attr(el.raw, 'cy'));
    const r = +attr(el.raw, 'r') * scale;
    if (isFinite(x) && isFinite(y)) nodes.push([r1(x), r1(y), Math.round(r * 1000) / 1000]);
    continue;
  }
  const sw = parseFloat(((attr(el.raw, 'style') || '').match(/stroke-width:([\d.eE+-]+)/) || [])[1] || '0.05');
  const thick = sw * scale >= 0.2;
  for (const poly of sample(attr(el.raw, 'd') || '')) {
    if (poly.length < 2) continue;
    const pts = poly.map(([x, y]) => apply(m, x, y));
    const ring = asRing(pts);
    if (ring) { rings.push(ring.map((v) => Math.round(v * 1000) / 1000)); continue; }
    const path = { pts: pts.map(([x, y]) => [r1(x), r1(y)]), thick };
    if (el.root) path.root = true;
    paths.push(path);
  }
}

// Orient root paths tip → base, so travelers (which run first point → last)
// flow inward toward the circle the roots hang from. The base is whichever end
// sits on something — a ring rim or another path's segment; the tip is free.
// Measured to segments, not sample points: a branch joining mid-curve can be
// ~STEP/2 away from the parent's nearest sample point.
const segDist = (px, py, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
};
const attachGap = ([x, y], self) => {
  let g = Infinity;
  for (const [rx, ry, rr] of rings) g = Math.min(g, Math.abs(Math.hypot(x - rx, y - ry) - rr));
  for (const p of paths) {
    if (p === self) continue;
    for (let k = 1; k < p.pts.length; k++) g = Math.min(g, segDist(x, y, p.pts[k - 1], p.pts[k]));
  }
  return g;
};
let reversed = 0;
for (const p of paths) {
  if (!p.root) continue;
  if (attachGap(p.pts[0], p) < attachGap(p.pts[p.pts.length - 1], p)) { p.pts.reverse(); reversed++; }
}

let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
const acc = (x, y) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); };
nodes.forEach((n) => acc(n[0], n[1]));
paths.forEach((p) => p.pts.forEach((pt) => acc(pt[0], pt[1])));

const data = { bbox: [r1(minx), r1(miny), r1(maxx), r1(maxy)], nodes, paths, rings };
fs.writeFileSync('svgnet_data.json', JSON.stringify(data));
const thick = paths.filter((p) => p.thick).length;
const totalPts = paths.reduce((s, p) => s + p.pts.length, 0);
console.log(`${file}: nodes ${nodes.length}  polylines ${paths.length} (thick ${thick} thin ${paths.length - thick})  pts ${totalPts}`);
console.log('bbox:', data.bbox);
console.log('rings [x,y,r]:', JSON.stringify(rings));
console.log(`roots: ${paths.filter((p) => p.root).length} (${reversed} reversed to run tip → base)`);
console.log('json:', (fs.statSync('svgnet_data.json').size / 1024).toFixed(1), 'KB');
