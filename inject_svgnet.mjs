import fs from 'fs';

const json = fs.readFileSync('svgnet_data.json', 'utf8').trim();
fs.writeFileSync('svgnet.js', 'var SVGNET = ' + json + ';\n');
console.log('svgnet.js written (' + (json.length / 1024).toFixed(1) + ' KB)');
