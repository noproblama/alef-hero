import { chromium } from './node_modules/playwright/index.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(4000);

// Measure FPS over ~1s + read constellation internals if reachable
const stats = await page.evaluate(async () => {
    const out = {};
    // FPS
    await new Promise(res => {
        let frames = 0; const t0 = performance.now();
        function tick(){ frames++; if (performance.now()-t0 < 1000) requestAnimationFrame(tick); else { out.fps = Math.round(frames*1000/(performance.now()-t0)); res(); } }
        requestAnimationFrame(tick);
    });
    // Try to reach _cs via global scope
    try {
        const cs = window._cs;
        if (cs) {
            out.hairs = cs.hairs.length;
            out.leads = cs.hairs.filter(h=>h.lead).length;
            out.dew = cs.dew.length;
            out.dewMaxW = Math.max(...cs.dew.map(d=>d.w));
        } else out.note = '_cs not on window';
    } catch(e){ out.err = String(e); }
    return out;
});
console.log('STATS', JSON.stringify(stats));

sorry// Zoomed crop of the centre region
await page.screenshot({ path: path.join(__dirname,'crop_centre.png'),
    clip: { x: 470, y: 250, width: 500, height: 400 } });
await browser.close();
