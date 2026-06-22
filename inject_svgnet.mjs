import fs from 'fs';
let html = fs.readFileSync('index.html', 'utf8');
const json = fs.readFileSync('svgnet_data.json', 'utf8').trim();

// remove any previously-injected SVGNET — single-line AND any orphan multiline body
// (a multiline body starts with 'bbox:' or 'nodes:' at indent and ends at a bare '};')
html = html.replace(/ *const SVGNET = \{[^\n]*\};\n/g, '');
// remove orphan multiline bodies (lines starting with bbox/nodes data without a const declaration)
const lines = html.split('\n');
let inOrphan = false, cleanLines = [];
for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!inOrphan && (t.startsWith('bbox:') || (t.startsWith('nodes:') && lines[i-1] && lines[i-1].trim().startsWith('bbox:')))) { inOrphan = true; }
    if (inOrphan) { if (t === '};') { inOrphan = false; } continue; }
    cleanLines.push(lines[i]);
}
html = cleanLines.join('\n');

const marker = '            const CNET = {';
if (!html.includes(marker)) { console.error('CNET marker not found'); process.exit(1); }
html = html.replace(marker, '            const SVGNET = ' + json + ';\n' + marker);

fs.writeFileSync('index.html', html);
console.log('injected SVGNET (' + (json.length / 1024).toFixed(1) + ' KB) before CNET');
