const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
let W, H, dpr;

function _getViewH() {
  // visualViewport tracks the actual rendered area on iOS (excludes browser chrome)
  return window.visualViewport
    ? window.visualViewport.height
    : window.innerHeight;
}

function resize() {
  // Cap dpr at 1 on touch devices — halves canvas pixel count (4× fewer pixels to draw)
  dpr = hasFinePointer ? window.devicePixelRatio || 1 : 1;
  W = window.innerWidth;
  H = _getViewH();
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
}
let _lastBuildW = 0;
let _hoverFade = 0; // 0=muted, 1=active hover
let _lastHovBtnIdx = -1; // last hovered btn — kept during fade-out
let _hoverPos = null; // interpolated world position of hover glow
let _bposCache = null;

function _onResize(widthChanged) {
  resize();
  // Height-only change (iOS chrome bar show/hide during scroll):
  // only update the canvas size — never reposition buttons or rebuild the net,
  // because button positions are computed from H/2 and would jump mid-scroll.
  if (!widthChanged) return;
  positionButtons();
  positionBird();
  positionCommunityText();
  if (Math.abs(W - _lastBuildW) < 10) return;
  _lastBuildW = W;
  btnAuraAlpha[0] = btnAuraAlpha[1] = btnAuraAlpha[2] = btnAuraAlpha[3] = 0;
  btnAlpha = 0;
  btnAnimStartT = null;
  initReveal();
}
// On browsers with visualViewport (all modern mobile), let it own resize handling —
// it correctly distinguishes width changes from toolbar show/hide (height-only).
// Fall back to window.resize for older browsers, but still track width to avoid
// misfiring positionButtons() on iOS toolbar show/hide.
let _prevWinW = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.visualViewport) return; // visualViewport handler below takes over
  const wChanged = Math.abs(window.innerWidth - _prevWinW) > 4;
  _prevWinW = window.innerWidth;
  _onResize(wChanged);
});
if (window.visualViewport) {
  let _prevVPW = window.visualViewport.width;
  let _prevVPH = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", () => {
    const w = window.visualViewport.width;
    const h = window.visualViewport.height;
    const wChanged = Math.abs(w - _prevVPW) > 4;
    if (Math.abs(h - _prevVPH) < 2 && !wChanged) return;
    _prevVPW = w;
    _prevVPH = h;
    _onResize(wChanged);
  });
}
resize();
_lastBuildW = W;
// Re-fire after load settles — iOS reports wrong innerHeight on first tick
setTimeout(() => {
  resize();
  positionButtons();
  positionBird();
}, 300);

const TAU = Math.PI * 2;
const mouse = { x: null, y: null, tx: null, ty: null };
const cursor = { x: null, y: null };
window.addEventListener("mousemove", (e) => {
  mouse.tx = e.clientX;
  mouse.ty = e.clientY;
  cursor.x = e.clientX;
  cursor.y = e.clientY;
});
window.addEventListener("mouseout", () => {
  mouse.tx = null;
  mouse.ty = null;
  cursor.x = null;
  cursor.y = null;
});
let T = 0;

// Centres of the 4 empty ring-circles in path1.svg (SVG coords), per button.
// [svgX, svgY, svgRingRadius] for each button's empty circle in path1.svg
const BTN_RINGS = [
  [95.1, 89.6, 11.366], // btn-0 Centre
  [95.5, 33.7, 12.253], // btn-1 Learning (slightly bigger)
  [148.7, 111.9, 11.366], // btn-2 Applied
  [41.2, 112.1, 11.366], // btn-3 Research
];
// Centre the network on the 4 button-rings' centroid (so the buttons are balanced).
function _netAnchor() {
  let ax = 0,
    ay = 0;
  for (const r of BTN_RINGS) {
    ax += r[0];
    ay += r[1];
  }
  return { ax: ax / BTN_RINGS.length, ay: ay / BTN_RINGS.length };
}
// Canvas layout per button: centre {x,y} + diameter d matching its SVG ring.
function _btnLayout() {
  if (typeof SVGNET !== "undefined" && SVGNET && typeof CNET !== "undefined") {
    const [bx0, by0, bx1, by1] = SVGNET.bbox;
    const sw = Math.max(1, bx1 - bx0),
      sh = Math.max(1, by1 - by0);
    const fit =
      Math.min((W * CNET.netW) / sw, (H * CNET.netH) / sh) * CNET.netZoom;
    const _an = _netAnchor(),
      scx = _an.ax,
      scy = _an.ay;
    const ox = W / 2 + CNET.netOffX,
      oy = H / 2 + CNET.netOffY;
    return BTN_RINGS.map(([sx, sy, r]) => ({
      x: ox + (sx - scx) * fit,
      y: oy + (sy - scy) * fit,
      d: 2 * r * fit * CNET.btnFit,
    }));
  }
  // fallback triangle (before SVGNET/CNET exist)
  const S = Math.min(W, H),
    R = S * (W < 600 ? 0.24 : 0.28),
    cx = W * 0.5,
    cy = H * 0.47,
    topA = -Math.PI / 2;
  const lx = cx + Math.cos(topA) * R,
    ly = cy + Math.sin(topA) * R;
  const ax = cx + Math.cos(topA + TAU / 3) * R,
    ay = cy + Math.sin(topA + TAU / 3) * R;
  const rx = cx + Math.cos(topA - TAU / 3) * R,
    ry = cy + Math.sin(topA - TAU / 3) * R;
  return [
    { x: (lx + ax + rx) / 3, y: (ly + ay + ry) / 3, d: 80 },
    { x: lx, y: ly, d: 80 },
    { x: ax, y: ay, d: 80 },
    { x: rx, y: ry, d: 80 },
  ];
}
function btnPositions() {
  return _btnLayout().map((b) => ({ x: b.x, y: b.y }));
}

function positionButtons() {
  const L = _btnLayout();
  _bposCache = L.map((b) => ({ x: b.x, y: b.y }));
  L.forEach((b, i) => {
    const el = document.getElementById(`btn-${i}`);
    if (el) {
      el.style.left = b.x + "px";
      el.style.top = b.y - b.d / 2 + "px";
      el.style.width = b.d + "px"; // pin btn width = ring → translate(-50%) centres exactly
      const ring = el.querySelector(".btn-ring");
      if (ring) {
        ring.style.width = b.d + "px";
        ring.style.height = b.d + "px";
      }
      const svg = el.querySelector(".btn-ring svg.dots");
      if (svg) svg.innerHTML = "";
    }
    const ic = document.getElementById(`icon-${i}`);
    if (ic) {
      ic.style.left = b.x + "px";
      ic.style.top = b.y + "px";
      const img = ic.querySelector(".icon-img");
      if (img) {
        const s = Math.round(b.d * 0.6);
        img.style.width = s + "px";
        img.style.height = s + "px";
      }
    }
  });
}

function positionBird(event) {
  const bird = document.getElementById("bird-img");
  if (!bird) return;

  const p1 = btnPositions()[1]; // ALEF LEARNING center
  const bw = W < 600 ? 88 : 144;
  const bh = bw * (134.87 / 143.45);
  const beakX = bw * -0.35;
  const beakY = bh * 0.4; // head top ~27% from top

  if (!bird) return;
  bird.style.width = bw + "px";
  bird.style.height = bh + "px";
  bird.style.transformOrigin = `${Math.round(beakX)}px ${Math.round(beakY)}px`;

  const left = p1.x - beakX + "px",
    top = p1.y - beakY + "px";
  bird.style.left = left;
  bird.style.top = top;
}

function positionCommunityText() {
  const u = Math.min(W, H) * 0.0028;
  const commY = H * 0.82;
  const el = document.getElementById("community-text");
  if (el) el.style.top = commY + u * 1.5 + 8 + "px";
  // On mobile, pull the scroll indicator up to sit just below COMMUNITY
  // so the two elements read as a visual group (not separated by a large gap)
  const scrollEl = document.getElementById("demo-scroll");
  if (scrollEl) {
    if (W < 600) {
      scrollEl.style.bottom = "";
      scrollEl.style.top = commY + 20 + "px";
    } else {
      scrollEl.style.top = "";
      scrollEl.style.bottom = "";
    }
  }
}

// ── Auras: per-button alpha, only after each ring is fully drawn ──────
let btnAlpha = 0;
let btnAnimStartT = null;
const btnAuraAlpha = [0, 0, 0, 0]; // per-button glow alpha

// ── CONSTELLATION SYSTEM ──

const CNET = {
  // ── imported SVG network (path1.svg → SVGNET) placement ──
  get netW() {
    return W < 600 ? 0.88 : 0.66;
  }, // portrait phone uses near-full width
  netH: 0.96,
  get netZoom() {
    if (W < 600) return 1.0; // portrait phone: netW=0.88 * 1.0 → same effective fit as old 0.44 * 2.0
    if (H < 500) return 0.65; // landscape phone: shrink to clear hero text gap
    return 0.8;
  },
  netOffX: 0,
  get netOffY() {
    if (W < 600) return -H * 0.07; // portrait phone: shift up to clear hero text
    if (H < 500) return -H * 0.02; // landscape phone: near-centre vertically
    return 0;
  },
  btnFit: 1.0, // button diameter as a fraction of its SVG ring
  netLineBright: 0.8, // thin-line brightness
  thickBright: 1.5, // thick-line brightness
  gradPeak: 1.0, // peak alpha for thick-line gradient travelers
  gradPeakThin: 0.71, // peak alpha for thin-line gradient travelers
  nodeBright: 1.25, // node-dot brightness
  flowSpeed: 0.115, // gradient traveler speed
  // ── render / glow ──
  junctionAlpha: 1.5, // node star-glow scale
  crispAlpha: 0.4, // crisp fiber alpha (additive build-up)
  bloomAlpha: 0.09, // bloom fiber alpha (additive halo)
  get bgCount() {
    return hasFinePointer ? 700 : 50;
  }, // reduce starfield on touch
  bgAlpha: 0.5, // background field brightness scale
};

// ── Per-load random seed → different layout each reload ───────────
const FIXED_SEED = 0xa3f2e1d4;
let _cnetSeed = FIXED_SEED;
function _cnetRng() {
  _cnetSeed ^= _cnetSeed << 13;
  _cnetSeed ^= _cnetSeed >>> 17;
  _cnetSeed ^= _cnetSeed << 5;
  _cnetSeed = _cnetSeed >>> 0;
  return _cnetSeed / 0x100000000;
}
function _cnetReseed() {
  _cnetSeed = (Date.now() ^ ((Math.random() * 0x100000) | 0)) >>> 0;
}

// ── Skeleton — imported geometry from svg image (SVGNET) ──────────
// SVGNET = { bbox:[x0,y0,x1,y1], nodes:[[x,y,r]...], paths:[[[x,y]...]] }
// Scaled + centred on the button centroid; paths → fiber lines, nodes → dots.
function _buildSkeleton(pos) {
  const cx = (pos[0].x + pos[1].x + pos[2].x + pos[3].x) / 4;
  const cy = (pos[0].y + pos[1].y + pos[2].y + pos[3].y) / 4;
  const hairs = [],
    flows = [],
    junctions = [];
  if (typeof SVGNET === "undefined" || !SVGNET)
    return { hairs, junctions, flows };

  const [bx0, by0, bx1, by1] = SVGNET.bbox;
  const sw = Math.max(1, bx1 - bx0),
    sh = Math.max(1, by1 - by0);
  const _an = _netAnchor(),
    scx = _an.ax,
    scy = _an.ay;
  const fit =
    Math.min((W * CNET.netW) / sw, (H * CNET.netH) / sh) * CNET.netZoom;
  const ox = W / 2 + CNET.netOffX,
    oy = H / 2 + CNET.netOffY; // screen-centred (matches btnPositions)
  const TX = (p) => ({
    x: ox + (p[0] - scx) * fit,
    y: oy + (p[1] - scy) * fit,
  });

  // paths → smooth fiber lines (dots come from the SVG nodes, not auto)
  const thickFlows = []; // gradient travelers on ALL paths
  for (const pathDef of SVGNET.paths) {
    const poly = pathDef.pts || pathDef;
    const thick = !!pathDef.thick;
    if (poly.length < 2) continue;
    const pts = poly.map(TX);
    const bright =
      (thick ? CNET.thickBright : CNET.netLineBright) *
      (0.8 + _cnetRng() * 0.4);
    hairs.push({ pts, bright, dotIdx: [], thick });
    const spanPts = 0.5; // length of the "gradient" - small dot
    const isClosed =
      Math.hypot(
        pts[0].x - pts[pts.length - 1].x,
        pts[0].y - pts[pts.length - 1].y,
      ) < 8;
    thickFlows.push({
      poly: pts,
      thick,
      phase: _cnetRng(),
      speed: CNET.flowSpeed * (0.5 + _cnetRng() * 0.5),
      spanPts,
      isClosed,
    });
  }
  // nodes → glowing dots sized by SVG radius (4 sizes → 4 glow levels)
  for (const n of SVGNET.nodes) {
    const p = TX(n),
      nr = n[2];
    const ndeg = nr > 0.8 ? 6 : nr > 0.55 ? 4 : nr > 0.38 ? 2 : 1;
    // two independent slow oscillators — irrational ratio avoids periodicity
    const freq = 0.06 + _cnetRng() * 0.12;
    const freq2 = freq * (1.47 + _cnetRng() * 0.52);
    junctions.push({
      x: p.x,
      y: p.y,
      deg: ndeg,
      r: Math.max(0.5, nr * fit * 1.4 * (0.35 + _cnetRng() * 1.9)),
      phase: _cnetRng() * TAU,
      phase2: _cnetRng() * TAU,
      freq,
      freq2,
    });
  }
  return { hairs, junctions, flows, thickFlows };
}

// ── Background starfield — shimmering nodes, denser toward centre ──
function _buildBackground(cx, cy) {
  const nodes = [];
  const bpos = btnPositions();
  for (let i = 0; i < CNET.bgCount; i++) {
    const x = _cnetRng() * W;
    const y = _cnetRng() * H;
    const size = 0.1 + _cnetRng() * 1.6;
    const phase = _cnetRng() * TAU;
    const bright = 0.35 + _cnetRng() * 0.75;
    const star = _cnetRng() < 0.05;
    const inBtn = bpos.some((p) => Math.hypot(x - p.x, y - p.y) < 68);
    if (!inBtn) nodes.push({ x, y, size, phase, bright, star });
  }
  return nodes;
}

// ── Dew nodes — where hairs from DIFFERENT paths cross (≤250) ──────
function _buildDew(hairs) {
  const R = 4,
    cell = R,
    gk = (a, b) => a * 100003 + b;
  const grid = new Map(),
    all = [];
  hairs.forEach((h, hi) => {
    for (const p of h.pts) all.push({ x: p.x, y: p.y, hi });
  });
  for (const p of all) {
    const k = gk(Math.floor(p.x / cell), Math.floor(p.y / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const bk = 7,
    buckets = new Map();
  for (const p of all) {
    const gx = Math.floor(p.x / cell),
      gy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(gk(gx + dx, gy + dy));
        if (!arr) continue;
        for (const q of arr) {
          if (q.hi === p.hi) continue;
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 > R * R) continue;
          const mx = (p.x + q.x) * 0.5,
            my = (p.y + q.y) * 0.5;
          const key = gk(Math.floor(mx / bk), Math.floor(my / bk));
          let e = buckets.get(key);
          if (!e) {
            e = { x: mx, y: my, s: new Set() };
            buckets.set(key, e);
          }
          e.s.add(p.hi);
          e.s.add(q.hi);
        }
      }
  }
  const dew = [...buckets.values()].map((e) => ({
    x: e.x,
    y: e.y,
    w: e.s.size,
  }));
  dew.sort((a, b) => b.w - a.w);
  return dew.slice(0, 180);
}

// ── Main state ────────────────────────────────────────────────────
let _cs = null;
let _lineRevealDone = false;

function buildConstellation(seed) {
  _cnetSeed = seed !== undefined ? seed : FIXED_SEED;
  const pos = btnPositions();
  const cx = (pos[0].x + pos[1].x + pos[2].x + pos[3].x) / 4;
  const cy = (pos[0].y + pos[1].y + pos[2].y + pos[3].y) / 4;
  const sk = _buildSkeleton(pos);
  const _L = _btnLayout();
  const dew = _buildDew(sk.hairs);
  const bg = _buildBackground(cx, cy);
  const beads = []; // node circle around the buttons removed
  _cs = {
    hairs: sk.hairs,
    junctions: sk.junctions,
    flows: sk.flows,
    thickFlows: sk.thickFlows,
    dew,
    bg,
    beads,
    pos,
    cx,
    cy,
    t0: performance.now(),
    learningY: _L[1].y,
  };
  constellation = {
    paths: [],
    partialArcs: [],
    encPaths: [],
    stitchPaths: [],
  };
  _shapeButtonsToNodes();
}

// ── Button rings are perfect circles in the SVG — clear any old polygon clip ──
function _shapeButtonsToNodes() {
  for (let i = 0; i < 4; i++) {
    const ringEl = document.querySelector(`#btn-${i} .btn-ring`);
    if (ringEl) ringEl.style.clipPath = "";
  }
}

// ── Star node renderers ───────────────────────────────────────────
function _drawStarNode(x, y, a, r = 4, coreR = 0.5, tc) {
  const c = tc || ctx;
  const peak = 0.62 * a;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,252,240,${peak})`);
  g.addColorStop(0.35, `rgba(255,248,225,${peak * 0.65})`);
  g.addColorStop(0.62, `rgba(255,235,185,${peak * 0.18})`);
  g.addColorStop(1, "rgba(255,220,160,0)");
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = g;
  c.fill();
  c.beginPath();
  c.arc(x, y, coreR, 0, TAU);
  c.fillStyle = `rgba(255,255,255,${0.78 * a})`;
  c.fill();
}
function _drawSparkle(x, y, a, r, coreR, tc) {
  const c = tc || ctx;
  _drawStarNode(x, y, a, r, coreR, tc);
  const arm = r * 1.8,
    peakC = 0.35 * a;
  for (const [ax, ay, bx, by] of [
    [x - arm, y, x + arm, y],
    [x, y - arm, x, y + arm],
  ]) {
    const g = c.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, "rgba(255,242,210,0)");
    g.addColorStop(0.5, `rgba(255,242,210,${peakC})`);
    g.addColorStop(1, "rgba(255,242,210,0)");
    c.strokeStyle = g;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
  }
}

// ── Live draw (called every frame) ────────────────────────────────
function drawConstellation(fadeIn) {
  if (!_cs) return;
  const fi = fadeIn ?? 1;
  const now = performance.now() * 0.001;
  const cx = _cs.cx,
    cy = _cs.cy;

  // ── Background starfield (live twinkle) ───────────────────────
  ctx.globalAlpha = 1;
  for (const n of _cs.bg) {
    const sh = (Math.sin(now * 1.2 + n.phase) + 1) * 0.5;
    const a = (0.5 + sh * 0.7) * n.bright * CNET.bgAlpha * fi;
    if (n.star) {
      _drawSparkle(n.x, n.y, a * 0.95, 2.4, 0.4);
    } else {
      ctx.fillStyle = `rgba(255,224,180,${a})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.size, 0, TAU);
      ctx.fill();
    }
  }

  // ── Fiber net: always drawn live — no cache switch (eliminates brightness jump) ──
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const h of _cs.hairs) {
    const bp = h.birthT ?? 0;
    const prog = _lineRevealDone
      ? 1
      : T < bp
        ? 0
        : Math.min(1, (T - bp) / (h.drawDur || 30));
    if (prog <= 0) continue;
    const P = h.pts;
    const nPts = prog >= 1 ? P.length : Math.max(2, Math.ceil(prog * P.length));
    // Hover brightness: smooth radial falloff from interpolated position
    let hm = 0.62;
    if (_hoverFade > 0.005 && _hoverPos) {
      let minD2 = Infinity;
      for (const p of P) {
        const dx = p.x - _hoverPos.x,
          dy = p.y - _hoverPos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      // Smooth falloff: full brightness ≤130 px, muted ≥330 px
      const t = Math.max(0, Math.min(1, (Math.sqrt(minD2) - 130) / 200));
      const brightMul = 1.25 - t * (1.25 - 0.18);
      hm = 0.62 + (brightMul - 0.62) * _hoverFade;
    }
    ctx.lineWidth = h.thick ? 2.4 : 1.6;
    ctx.strokeStyle = `rgba(255,205,150,${CNET.bloomAlpha * h.bright * hm})`;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < nPts; i++) ctx.lineTo(P[i].x, P[i].y);
    ctx.stroke();
    ctx.lineWidth = h.thick ? 0.9 : 0.6;
    ctx.strokeStyle = `rgba(255,240,210,${CNET.crispAlpha * h.bright * hm})`;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < nPts; i++) ctx.lineTo(P[i].x, P[i].y);
    ctx.stroke();
    if (prog >= 1 && h.dotIdx && h.dotIdx.length) {
      ctx.fillStyle = `rgba(255,242,214,${CNET.dotAlpha})`;
      ctx.beginPath();
      for (const idx of h.dotIdx) {
        const p = P[idx];
        if (!p) continue;
        ctx.moveTo(p.x + 0.9, p.y);
        ctx.arc(p.x, p.y, 0.9, 0, TAU);
      }
      ctx.fill();
    }
  }
  ctx.restore();

  // ── Bright sparkles at the busiest crossings (live twinkle) ───
  ctx.globalAlpha = 1;
  const _btnPosForDraw = _bposCache || btnPositions();
  const _btnExclR = 68;

  // ── Junction nodes: always live, continuously twinkling ────────
  ctx.globalCompositeOperation = "lighter";
  if (_cs.junctions)
    for (const nd of _cs.junctions) {
      if (
        _btnPosForDraw.some(
          (p) => Math.hypot(nd.x - p.x, nd.y - p.y) < _btnExclR,
        )
      )
        continue;
      const revA =
        nd.birthT != null
          ? Math.min(1, Math.max(0, (T - nd.birthT) / (nd.revealDur || 18)))
          : 1;
      if (revA <= 0) continue;
      const dn = Math.min(1, nd.deg / 6);
      // Dual-harmonic oscillator: irrational ratio → aperiodic organic pulse
      const s1 = (Math.sin(now * nd.freq + nd.phase) + 1) * 0.5;
      const s2 =
        (Math.sin(
          now * (nd.freq2 ?? nd.freq * 1.73) + (nd.phase2 ?? nd.phase + 1.2),
        ) +
          1) *
        0.5;
      const twinkle = 0.22 + 0.52 * s1 + 0.26 * s2;
      const baseA = CNET.nodeBright * CNET.junctionAlpha * (0.4 + dn * 0.6);
      const glowA = baseA * twinkle * revA;
      if (glowA < 0.008) continue;
      // Size also gently pulses in sync
      const rr = (nd.r || 1.2 + dn * 2.4) * (0.82 + 0.18 * s1);
      _drawStarNode(nd.x, nd.y, glowA, rr, Math.min(0.7, rr * 0.32));
    }
  ctx.globalCompositeOperation = "source-over";

  // ── Gradient travelers — only after all lines revealed, fade in smoothly ─
  // Skip on touch devices (too expensive for mobile GPUs)
  if (!_lineRevealDone) {
    ctx.globalCompositeOperation = "source-over";
  }
  if (_lineRevealDone && hasFinePointer) {
    if (!_cs._travelFadeStartT) _cs._travelFadeStartT = T;
    const _travelA = Math.min(1, (T - _cs._travelFadeStartT) / 50);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = _travelA;
    ctx.lineCap = "round";
    for (const fl of _cs.thickFlows || []) {
      const poly = fl.poly,
        n = poly.length;
      if (n < 2) continue;
      ctx.lineWidth = 0.6;
      const peakBase = fl.thick ? CNET.gradPeak : CNET.gradPeakThin;
      const halfF = fl.spanPts / 2;
      const centreF = ((now * fl.speed + fl.phase) % 1) * n;
      const startF = centreF - halfF;
      const endF = centreF + halfF;
      // Helper: interpolate a sub-pixel point on the polyline
      const ptAt = (f) => {
        const clamped = fl.isClosed
          ? ((f % n) + n) % n
          : Math.max(0, Math.min(n - 1.001, f));
        const i0 = Math.floor(clamped);
        const i1 = Math.min(n - 1, i0 + 1);
        const frac = clamped - i0;
        const a = poly[i0],
          b = poly[i1];
        return {
          x: a.x + (b.x - a.x) * frac,
          y: a.y + (b.y - a.y) * frac,
        };
      };
      // Envelope: fade in/out gracefully near path ends
      let peak = peakBase;
      if (!fl.isClosed) {
        if (endF > n - 1) {
          // gradient leaving far end — fade out smoothly
          peak = peakBase * Math.max(0, (n - 1 - centreF) / halfF);
          if (peak < 0.01) continue;
        } else if (startF < 0) {
          // gradient entering from near end — fade in
          peak = peakBase * Math.max(0, centreF / halfF);
          if (peak < 0.01) continue;
        }
      }
      // Clamp fractional endpoints for open paths
      const sf = fl.isClosed ? startF : Math.max(0, startF);
      const ef = fl.isClosed ? endF : Math.min(n - 1.001, endF);
      const startPt = ptAt(sf),
        endPt = ptAt(ef);
      // Single linearGradient spanning the window → perfectly smooth 0→peak→0
      const grd = ctx.createLinearGradient(
        startPt.x,
        startPt.y,
        endPt.x,
        endPt.y,
      );
      grd.addColorStop(0, `rgba(255,242,205,0)`);
      grd.addColorStop(0.5, `rgba(255,242,205,${peak})`);
      grd.addColorStop(1, `rgba(255,242,205,0)`);
      ctx.strokeStyle = grd;
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      const i0 = Math.ceil(sf),
        i1 = Math.floor(ef);
      if (fl.isClosed) {
        const steps = ((i1 - i0 + n) % n) + 1;
        for (let k = 0; k < steps; k++) {
          const p = poly[(i0 + k + n) % n];
          ctx.lineTo(p.x, p.y);
        }
      } else {
        for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++)
          ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.lineTo(endPt.x, endPt.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  } // end _lineRevealDone gate

  // ── Ring beads (live) ─────────────────────────────────────────
  ctx.globalAlpha = fi;
  for (const b of _cs.beads) {
    const tw = 0.8 + 0.2 * Math.sin(now * 2.4 + b.x * 0.008 + b.y * 0.006);
    _drawStarNode(b.x, b.y, b.a * tw, b.r, 0.5);
  }
  ctx.globalAlpha = 1;
}

let cursorMagnet = { strength: 0 };
let hoveredBtnIdx = -1;

function setupBtnHoverListeners() {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`btn-${i}`);
    if (!el) continue;
    el.addEventListener("mouseenter", () => {
      hoveredBtnIdx = i;
      document.getElementById(`icon-${i}`)?.classList.add("hovered");
    });
    el.addEventListener("mouseleave", () => {
      hoveredBtnIdx = -1;
      document.getElementById(`icon-${i}`)?.classList.remove("hovered");
    });
  }
}

function drawCursorDot(dt = 1) {
  const mx = cursor.x,
    my = cursor.y;
  if (mx === null) return;

  const pos = btnPositions();
  const L = _btnLayout();
  const nearBtn = hoveredBtnIdx;

  const targetStrength = nearBtn >= 0 ? 1 : 0;
  const lerpRate = targetStrength > cursorMagnet.strength ? 0.05 : 0.1; // fast in, slow out
  cursorMagnet.strength +=
    (targetStrength - cursorMagnet.strength) * Math.min(1, lerpRate * dt);

  const s = cursorMagnet.strength;

  // Interpolate dot position: travels from cursor → button centre
  let dx = mx,
    dy = my;
  if (nearBtn >= 0) {
    dx = mx + (pos[nearBtn].x - mx) * s;
    dy = my + (pos[nearBtn].y - my) * s;
  }

  const pulse = 0.82 + 0.18 * Math.sin(T * 0.038);

  // As dot reaches button: it grows into a glow, core fades, becomes pure light
  const coreAlpha = (1 - s) * (0.95 + 0.15 * pulse);
  const glowScale = 1 + s * 10; // glow expands as it merges into button
  const glowAlpha = 0.76 * (pulse + s * 0.5);

  const r = (2.0 + 1.0 * pulse) * Math.max(0.4, 1 - s * 0.6);
  const glowR = (r * 6 * glowScale * L[0].d) / 80;

  const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, glowR);
  g.addColorStop(0, `rgba(255,255,255,${glowAlpha})`);
  g.addColorStop(0.4, `rgba(255,255,255,${glowAlpha * 0.3})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.arc(dx, dy, glowR, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();

  // Core dot — disappears as it merges into the button glow
  if (coreAlpha > 0.05) {
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.55, 0, TAU);
    ctx.fillStyle = `rgba(255,255,255,${coreAlpha})`;
    ctx.fill();
  }

  // Extra pulsing glow at button when fully there — like switch turned on
  if (s > 0.1 && nearBtn >= 0) {
    const bp = pos[nearBtn];
    const switchPulse = 0.5 + 0.5 * Math.sin(T * 0.07 + 1.2);
    const switchGlow = s * (0.28 + 0.22 * switchPulse);
    const glowR = 88 + switchPulse * 18;
    const gBtn = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, glowR);
    gBtn.addColorStop(0, `rgba(255,255,255,${switchGlow})`);
    gBtn.addColorStop(0.35, `rgba(240,225,180,${switchGlow * 0.5})`);
    gBtn.addColorStop(0.7, `rgba(255,220,140,${switchGlow * 0.15})`);
    gBtn.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, glowR, 0, TAU);
    ctx.fillStyle = gBtn;
    ctx.fill();
  }
}
let _prevFrameMs = performance.now();
let _frameSkip = 0;
function animate() {
  // On touch devices skip every other rAF → ~30fps, halves CPU/GPU cost
  if (!hasFinePointer) {
    _frameSkip ^= 1;
    if (_frameSkip) {
      requestAnimationFrame(animate);
      return;
    }
  }
  // Delta-time: how many 60fps ticks elapsed since last frame.
  // Caps at 4 to avoid huge jumps after tab sleep.
  const _nowMs = performance.now();
  const _dt = Math.min(4, ((_nowMs - _prevFrameMs) * 60) / 1000);
  _prevFrameMs = _nowMs;
  T += _dt;

  if (mouse.tx !== null) {
    const _mr = 1 - Math.pow(1 - 0.008, _dt);
    mouse.x =
      mouse.x === null ? mouse.tx : mouse.x + (mouse.tx - mouse.x) * _mr;
    mouse.y =
      mouse.y === null ? mouse.ty : mouse.y + (mouse.ty - mouse.y) * _mr;
  } else {
    mouse.x = null;
    mouse.y = null;
  }

  // Button canvas elements — per-button aura fades in after each ring is done
  if (T >= 20) {
    if (btnAnimStartT === null) btnAnimStartT = T;
    // btnAlpha for backward compat (ring nodes use it)
    const allDone = window._btnRingDone
      ? Math.max(...window._btnRingDone)
      : T + 100;
    btnAlpha = Math.min(1, (T - 20) / (allDone - 20 + 10));

    // Per-button aura: starts fading in only after that button's ring is complete
    if (window._btnRingDone) {
      window._btnRingDone.forEach((doneT, bi) => {
        if (T >= doneT) {
          btnAuraAlpha[bi] = Math.min(1, (T - doneT) / 80);
        }
        const textStart = doneT + 10;
        if (T >= textStart) {
          const ta = Math.min(1, (T - textStart) / 40);
          const el = document.getElementById(`btn-${bi}`);
          if (el) {
            el.style.opacity = ta;
            el.style.pointerEvents = ta > 0.05 ? "auto" : "none";
          }
          const iconEl = document.getElementById(`icon-${bi}`);
          if (iconEl) iconEl.style.opacity = ta * 1;
        }
      });
    }

    // Mark line reveal complete once last line has finished drawing
    if (!_lineRevealDone && _cs && _cs.hairs) {
      const lastBirth = Math.max(..._cs.hairs.map((h) => h.birthT ?? 0));
      const lastDur = Math.max(..._cs.hairs.map((h) => h.drawDur ?? 30));
      if (T >= lastBirth + lastDur + 5) {
        _lineRevealDone = true;
      }
    }

    if (
      !window._btnRevealed &&
      window._btnRingDone &&
      T >= Math.max(...window._btnRingDone) + 50
    ) {
      window._btnRevealed = true;
      document
        .querySelectorAll(".btn")
        .forEach((el) => el.classList.add("visible"));
    }

    if (
      !window._birdRevealed &&
      window._btnRingDone &&
      T >= Math.max(...window._btnRingDone)
    ) {
      window._birdRevealed = true;
      const bird = document.getElementById("bird-img");
      if (bird) {
        bird.style.opacity = "1";
        bird.style.transform = "translateX(0) translateY(0)";
        bird.addEventListener("transitionend", function onFlyIn(e) {
          if (e.propertyName !== "opacity") return;
          bird.removeEventListener("transitionend", onFlyIn);
          setTimeout(() => bird.classList.add("hovering"), 8500);
        });
      }
    }
  }

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(8,6,2,0.10)";
  ctx.fillRect(0, 0, W, H);

  // Smooth hover fade: 0=fully muted, 1=node hovered
  const _hoverTarget = hoveredBtnIdx >= 0 ? 1.0 : 0.0;
  const _hoverRate = _hoverTarget > _hoverFade ? 0.03 : 0.012;
  _hoverFade += (_hoverTarget - _hoverFade) * Math.min(1, _hoverRate * _dt);
  // Keep position reference alive during fade-out; lerp between buttons
  if (hoveredBtnIdx >= 0) _lastHovBtnIdx = hoveredBtnIdx;
  if (_lastHovBtnIdx >= 0 && _bposCache) {
    const tgt = _bposCache[_lastHovBtnIdx];
    if (tgt) {
      if (!_hoverPos) _hoverPos = { x: tgt.x, y: tgt.y };
      else {
        const _pr = Math.min(1, 0.05 * _dt);
        _hoverPos.x += (tgt.x - _hoverPos.x) * _pr;
        _hoverPos.y += (tgt.y - _hoverPos.y) * _pr;
      }
    }
  }

  drawConstellation(1);
  drawCursorDot(_dt);
  requestAnimationFrame(animate);
}

positionButtons();
setupBtnHoverListeners();
positionBird();

// Autoplay with fallback hide if blocked (e.g. iOS low-power mode)
(function () {
  const vid = document.getElementById("video-bg");
  if (!vid) return;
  const playPromise = vid.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      vid.style.display = "none";
    });
  }
})();

function initReveal() {
  // Reset animation state
  T = 0;
  btnAlpha = 0;
  btnAnimStartT = null;
  window._btnRevealed = false;
  window._birdRevealed = false;
  const bird = document.getElementById("bird-img");
  if (bird) {
    bird.style.opacity = "0";
    bird.style.transform = "translateX(60vw) translateY(-180vh)";
    bird.classList.remove("hovering");
  }
  document.querySelectorAll(".btn").forEach((el) => {
    el.classList.remove("visible");
    el.style.opacity = 0;
    el.style.pointerEvents = "none";
  });
  document.querySelectorAll(".icon-slot").forEach((el) => {
    el.style.opacity = 0;
  });

  // Buttons appear first — staggered: Learning → Centre → Applied+Research
  const SEQ_IDX = { 0: 1, 1: 0, 2: 2, 3: 2 };
  const BTN_STAGGER = hasFinePointer ? 12 : 0;
  window._btnRingDone = [];
  btnPositions().forEach((bp, bi) => {
    window._btnRingDone[bi] = SEQ_IDX[bi] * BTN_STAGGER;
  });

  // Rebuild constellation so stars/edges reset with new positions
  buildConstellation();

  // Assign per-element birthT: outward from button centers
  _lineRevealDone = false;
  if (_cs && _cs.hairs) {
    const pos = btnPositions();
    const distFromBtn = (x, y) =>
      Math.min(...pos.map((p) => Math.hypot(x - p.x, y - p.y)));

    // Net starts after last button has begun appearing
    const NET_START = Math.max(...window._btnRingDone) + 15;
    const NODE_SWEEP = 120;
    const NODE_DUR = 44;
    const LINE_SWEEP = 90;
    const LINE_DUR = 150;

    // Find max distance to normalise
    let maxDist = 1;
    (_cs.junctions || []).forEach((nd) => {
      const d = distFromBtn(nd.x, nd.y);
      if (d > maxDist) maxDist = d;
    });
    _cs.hairs.forEach((h) =>
      h.pts.forEach((p) => {
        const d = distFromBtn(p.x, p.y);
        if (d > maxDist) maxDist = d;
      }),
    );

    if (_cs.junctions) {
      _cs.junctions.forEach((nd) => {
        const frac = Math.min(1, distFromBtn(nd.x, nd.y) / maxDist);
        nd.birthT = Math.round(NET_START + frac * NODE_SWEEP);
        nd.revealDur = NODE_DUR;
      });
    }
    _cs.hairs.forEach((h) => {
      const minDist = Math.min(...h.pts.map((p) => distFromBtn(p.x, p.y)));
      const frac = Math.min(1, minDist / maxDist);
      h.birthT = Math.round(NET_START + frac * LINE_SWEEP);
      h.drawDur = LINE_DUR;
    });
  }
}

initReveal();
animate();

// ── Dev Panel (toggle with D key) ────────────────────────────────
const FONT_PAIRS = [
  {
    name: "Playfair + Inter",
    heading: "'Playfair Display',Georgia,serif",
    hw: "500",
    body: "'Inter',-apple-system,sans-serif",
    nav: "'Cormorant Garamond',Georgia,serif",
    navT: "0.06em",
  },
  {
    name: "Cormorant + Inter",
    heading: "'Cormorant Garamond',Georgia,serif",
    hw: "500",
    body: "'Inter',-apple-system,sans-serif",
    nav: "'Cormorant Garamond',Georgia,serif",
    navT: "0.18em",
  },
  {
    name: "Editorial",
    heading: "'Playfair Display',Georgia,serif",
    hw: "500",
    body: "'Lora',Georgia,serif",
    nav: "'Lora',Georgia,serif",
    navT: "0.10em",
  },
  {
    name: "Literary",
    heading: "'Libre Baskerville',Georgia,serif",
    hw: "400",
    body: "'Inter',-apple-system,sans-serif",
    nav: "'Libre Baskerville',Georgia,serif",
    navT: "0.11em",
  },
  {
    name: "Contemporary",
    heading: "'Spectral',Georgia,serif",
    hw: "300",
    body: "'Source Serif 4',Georgia,serif",
    nav: "'Source Serif 4',Georgia,serif",
    navT: "0.10em",
  },
  {
    name: "Journalistic",
    heading: "'Merriweather',Georgia,serif",
    hw: "300",
    body: "'Lora',Georgia,serif",
    nav: "'Lora',Georgia,serif",
    navT: "0.09em",
  },
];
function applyFontPair(idx) {
  const fp = FONT_PAIRS[idx];
  const r = document.documentElement.style;
  r.setProperty("--font-heading", fp.heading);
  r.setProperty("--font-heading-weight", fp.hw);
  r.setProperty("--font-body", fp.body);
  r.setProperty("--font-nav", fp.nav);
  r.setProperty("--font-nav-tracking", fp.navT);
}
(function () {
  const panel = document.createElement("div");
  panel.id = "dev-panel";
  panel.style.cssText =
    "display:none;position:fixed;top:10px;right:10px;z-index:9999;background:rgba(0,0,0,0.88);border:1px solid rgba(255,200,100,0.35);border-radius:8px;padding:14px 16px;font-family:monospace;font-size:11px;color:#f0d080;width:260px;max-height:90vh;overflow-y:auto;";
  panel.innerHTML =
    '<div style="margin-bottom:10px;font-weight:bold;font-size:12px;letter-spacing:.05em;">CNET DEV PANEL <span style="font-weight:normal;opacity:.6;">— D to close</span></div>';
  document.body.appendChild(panel);

  // [key, label, min, max, step, scale]  — displayed value = CNET[key]*scale
  const PARAMS = [
    ["netLineBright", "Thin bright ×100", 10, 150, 5, 100],
    ["thickBright", "Thick bright ×100", 10, 160, 5, 100],
    ["nodeBright", "Node bright ×100", 10, 160, 5, 100],
    ["junctionAlpha", "Node glow ×100", 5, 150, 5, 100],
    ["crispAlpha", "Crisp alpha ×100", 2, 40, 1, 100],
    ["bloomAlpha", "Bloom alpha ×1000", 5, 120, 1, 1000],
    ["flowSpeed", "Gradient speed ×1000", 5, 200, 5, 1000],
    ["gradPeak", "Thick glow ×100", 10, 150, 5, 100],
    ["gradPeakThin", "Thin glow ×100", 5, 80, 2, 100],
    ["bgCount", "BG nodes", 0, 1000, 50, 1],
    ["bgAlpha", "BG alpha ×100", 0, 150, 5, 100],
  ];
  PARAMS.forEach(([key, label, min, max, step, scale]) => {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;";
    const lbl = document.createElement("div");
    lbl.style.cssText =
      "display:flex;justify-content:space-between;margin-bottom:2px;";
    const valSpan = document.createElement("span");
    valSpan.id = "dp-" + key;
    valSpan.textContent = Math.round(CNET[key] * scale);
    lbl.innerHTML = `<span>${label}</span>`;
    lbl.appendChild(valSpan);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.value = Math.round(CNET[key] * scale);
    inp.style.cssText = "width:100%;cursor:pointer;accent-color:#f0d080;";
    inp.addEventListener("input", () => {
      CNET[key] = inp.value / scale;
      document.getElementById("dp-" + key).textContent = inp.value;
      buildConstellation();
    });
    row.appendChild(lbl);
    row.appendChild(inp);
    panel.appendChild(row);
  });

  // RESEED button
  const reseedBtn = document.createElement("button");
  reseedBtn.textContent = "RESEED";
  reseedBtn.style.cssText =
    "margin-top:10px;width:100%;padding:6px;background:rgba(255,200,100,0.18);border:1px solid rgba(255,200,100,0.45);border-radius:4px;color:#f0d080;font-family:monospace;font-size:11px;cursor:pointer;letter-spacing:.08em;";
  reseedBtn.addEventListener("click", () => {
    _cnetReseed();
    buildConstellation(_cnetSeed);
  });
  panel.appendChild(reseedBtn);

  // Font pair selector
  const fpDiv = document.createElement("div");
  fpDiv.style.cssText =
    "margin-top:12px;border-top:1px solid rgba(255,200,100,0.2);padding-top:10px;";
  fpDiv.innerHTML =
    '<div style="margin-bottom:7px;font-size:10px;letter-spacing:.1em;opacity:.65;">FONT PAIRS</div>';
  const fpBtns = [];
  FONT_PAIRS.forEach((fp, i) => {
    const b = document.createElement("button");
    const hName = fp.heading.replace(/'/g, "").split(",")[0].trim();
    const bName = fp.body.replace(/'/g, "").split(",")[0].trim();
    b.innerHTML =
      '<span style="display:block">' +
      (i + 1) +
      "  " +
      fp.name +
      '</span><span style="font-size:9px;opacity:0.50;letter-spacing:.02em;">' +
      hName +
      " · " +
      bName +
      "</span>";
    b.dataset.fpIdx = i;
    b.style.cssText =
      "display:block;width:100%;margin-bottom:4px;padding:5px 8px;background:rgba(255,200,100,0.10);border:1px solid rgba(255,200,100,0.28);border-radius:3px;color:#f0d080;font-family:monospace;font-size:10px;cursor:pointer;letter-spacing:.06em;text-align:left;line-height:1.5;";
    b.addEventListener("click", () => {
      applyFontPair(i);
      fpBtns.forEach(
        (bb, j) =>
          (bb.style.background =
            j === i ? "rgba(255,200,100,0.30)" : "rgba(255,200,100,0.10)"),
      );
    });
    fpBtns.push(b);
    fpDiv.appendChild(b);
  });
  applyFontPair(0); // Cormorant + Lora is default
  fpBtns[0].style.background = "rgba(255,200,100,0.30)";
  panel.appendChild(fpDiv);

  document.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });
})();

// Mobile hamburger toggle
const _hamburger = document.getElementById("mobile-hamburger");
const _mobileNav = document.getElementById("demo-nav");
if (_hamburger && _mobileNav) {
  _hamburger.addEventListener("click", (e) => {
    e.stopPropagation();
    _mobileNav.classList.toggle("mobile-open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#demo-header")) {
      _mobileNav.classList.remove("mobile-open");
    }
  });
}
