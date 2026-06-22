import { chromium } from './node_modules/playwright/index.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const outPath = process.argv[2] || path.join(__dirname, 'screenshot.png');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`file://${htmlPath}`);

// Wait for the animation to run to frame ~200 so constellation is fully drawn
await page.waitForTimeout(6000);

await page.screenshot({ path: outPath, fullPage: false });
await browser.close();
console.log('Screenshot saved:', outPath);
