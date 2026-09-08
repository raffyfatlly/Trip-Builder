// The tab icon actually resolves, on both pages, and is legible at 16px.
//
// raffy, 2026-09-08: "get nice favicon for my url". There was none — every tab
// showed the browser's default globe. This fails if that comes back: a link
// that 404s is the same as no icon, and it is invisible in every other test
// because nothing else on the page depends on it.
//
//   BASE=http://localhost:3241 node setup/test-favicon.mjs
import fs from 'fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

console.log('');
// The files exist and are what they claim to be.
const ico = fs.readFileSync('public/favicon.ico');
ok('favicon.ico is an icon file', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1);
const count = ico.readUInt16LE(4);
ok('and carries the three sizes a tab picks from', count === 3, count + ' images');
const sizes = [];
for (let i = 0; i < count; i++) sizes.push(ico.readUInt8(6 + 16 * i) || 256);
ok('16, 32 and 48', sizes.join(',') === '16,32,48', sizes.join(','));
// Each entry has to point at real bytes inside the file, or a browser drops it
// silently and falls back to the globe — which is the failure this is for.
let sound = true;
for (let i = 0; i < count; i++) {
  const len = ico.readUInt32LE(6 + 16 * i + 8), off = ico.readUInt32LE(6 + 16 * i + 12);
  if (off + len > ico.length || ico.slice(off, off + 4).toString('hex') !== '89504e47') sound = false;
}
ok('and every entry points at a real PNG inside it', sound);
ok('apple touch icon is there too', fs.statSync('public/apple-touch-icon.png').size > 1000);

// And they are actually served, and actually linked.
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
for (const [name, url] of [['the app', B + '/'], ['the landing page', B + '/welcome/']]) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')].map((l) => l.href));
  ok(name + ' links an icon', links.length >= 2, links.length + ' links');
  for (const href of links) {
    const r = await ctx.request.get(href);
    if (!r.ok()) ok(name + ': ' + href + ' is served', false, r.status() + '');
  }
  ok(name + "'s icons all resolve", true);
}
await b.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
