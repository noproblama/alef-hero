import fs from 'fs';
const svg = fs.readFileSync('full_network_circle_btn.svg','utf8');

// Find the translate used by translated layers
const gm = svg.match(/<g\b[^>]*transform="translate\(([-0-9.]+),([-0-9.]+)\)"/);
const tx = gm ? +gm[1] : 0, ty = gm ? +gm[2] : 0;
const r1 = x => Math.round(x * 10) / 10;

// layer1 has NO translate — extract its content so we can detect circles inside it
// and skip the translate offset for those elements (they are already in visual coords)
const layer1m = svg.match(/<g\b[^>]*id="layer1"[^>]*>([\s\S]*?)<\/g>/);
const layer1Content = layer1m ? layer1m[0] : '';

// ── circles → nodes [x,y,r] ──
const nodes = (svg.match(/<circle\b[^>]*?\/?>/gs) || []).map(el => {
    const cx = +(el.match(/\scx="([-0-9.eE]+)"/) || [])[1];
    const cy = +(el.match(/\scy="([-0-9.eE]+)"/) || [])[1];
    const r  = +(el.match(/\br="([-0-9.eE]+)"/)  || [])[1];
    // layer1 circles have no translate — use raw coords unchanged
    const inLayer1 = layer1Content.includes(el);
    return [r1(cx + (inLayer1 ? 0 : tx)), r1(cy + (inLayer1 ? 0 : ty)), Math.round(r * 1000) / 1000];
}).filter(n => isFinite(n[0]) && isFinite(n[1]));

// ── path sampler ──
const STEP = 2.4;
function sample(d) {
    const t = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
    let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
    const polys = []; let cur = null;
    const num = () => parseFloat(t[i++]);
    const moveTo = (x, y) => { cur = [[x, y]]; polys.push(cur); cx = x; cy = y; sx = x; sy = y; };
    const lineTo = (x, y) => { if (!cur) moveTo(x, y); else { cur.push([x, y]); cx = x; cy = y; } };
    function cubic(x1, y1, x2, y2, x, y) {
        const p0x = cx, p0y = cy;
        const len = Math.hypot(x - p0x, y - p0y) + Math.hypot(x1 - p0x, y1 - p0y) + Math.hypot(x2 - x, y2 - y);
        const n = Math.max(2, Math.round(len / STEP));
        for (let k = 1; k <= n; k++) { const u = k / n, m = 1 - u;
            cur.push([m*m*m*p0x + 3*m*m*u*x1 + 3*m*u*u*x2 + u*u*u*x,
                      m*m*m*p0y + 3*m*m*u*y1 + 3*m*u*u*y2 + u*u*u*y]); }
        cx = x; cy = y;
    }
    while (i < t.length) {
        const tk = t[i];
        if (/[A-Za-z]/.test(tk)) { cmd = tk; i++; }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        if (C === 'M') { let x = num(), y = num(); if (rel) { x += cx; y += cy; } moveTo(x, y); cmd = rel ? 'l' : 'L'; }
        else if (C === 'L') { let x = num(), y = num(); if (rel) { x += cx; y += cy; } lineTo(x, y); }
        else if (C === 'H') { let x = num(); if (rel) x += cx; lineTo(x, cy); }
        else if (C === 'V') { let y = num(); if (rel) y += cy; lineTo(cx, y); }
        else if (C === 'C') { let x1=num(),y1=num(),x2=num(),y2=num(),x=num(),y=num(); if (rel){x1+=cx;y1+=cy;x2+=cx;y2+=cy;x+=cx;y+=cy;} cubic(x1,y1,x2,y2,x,y); }
        else if (C === 'Z') { if (cur && (cx !== sx || cy !== sy)) cur.push([sx, sy]); cx = sx; cy = sy; }
        else { i++; }
    }
    return polys;
}

// ── parse paths with stroke-width tag ──
const paths = [];
for (const m of svg.matchAll(/<path\b([^>]*)\sd="([^"]*)"/g)) {
    const attrs = m[1];
    const sw = (attrs.match(/stroke-width:([\d.]+)/) || [])[1] || '0.05';
    const thick = parseFloat(sw) >= 0.2;
    for (const poly of sample(m[2])) {
        if (poly.length < 2) continue;
        paths.push({ pts: poly.map(([x, y]) => [r1(x + tx), r1(y + ty)]), thick });
    }
}

// bbox
let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
const acc = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
nodes.forEach(n => acc(n[0], n[1]));
paths.forEach(p => p.pts.forEach(pt => acc(pt[0], pt[1])));

const data = { bbox: [r1(minx), r1(miny), r1(maxx), r1(maxy)], nodes, paths };
fs.writeFileSync('svgnet_data.json', JSON.stringify(data));
const thick = paths.filter(p=>p.thick).length, thin = paths.filter(p=>!p.thick).length;
const totalPts = paths.reduce((s, p) => s + p.pts.length, 0);
console.log(`nodes: ${nodes.length}  polylines: ${paths.length} (thick:${thick} thin:${thin})  pts: ${totalPts}`);
console.log('bbox:', data.bbox);
console.log('json:', (fs.statSync('svgnet_data.json').size / 1024).toFixed(1), 'KB');
