import fs from 'fs';
let html = fs.readFileSync('index.html', 'utf8');
for (const f of ['centre.svg', 'learning.svg', 'applied.svg', 'research.svg']) {
    let svg = fs.readFileSync(f, 'utf8')
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const before = html;
    html = html.split('url(' + f + ')').join('url("' + uri + '")');
    console.log(f, before === html ? 'NO MATCH' : 'inlined');
}
fs.writeFileSync('index.html', html);
console.log('done');
