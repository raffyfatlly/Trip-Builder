// The typefaces are part of the template, not something a renderer adds.
//
// raffy, 2026-09-02, on the third round of this: "still not the font I want.
// bake it in the structure."
//
// They used to be spliced in at render time, which meant the fonts a trip got
// depended on the version of renderer/render.js that produced it — and that
// file ships in the browser bundle. A phone holding a cached bundle from before
// the fix fetched a fresh template from the server, ran an OLD renderer over
// it, and got a trip pointing at fonts/outfit.woff2 — a path that resolves
// nowhere, so the app fell back to the system font. The chrome around it is
// server-rendered and was always fresh, so it looked right. One app, two
// typefaces, and no amount of redeploying changed it.
//
// A splice is a step that can be skipped. A structure cannot be.
//
//   node setup/test-fontbaked.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

console.log('');
ok('the template itself carries both faces',
   (tpl.match(/font\/woff2;base64/g) || []).length === 2);
ok('and asks for no font over the network',
   !/url\(fonts\//.test(tpl) && !/fonts\.googleapis|fonts\.gstatic/.test(tpl));

const { html } = render(REAL, tpl);
ok('a rendered trip carries them too', (html.match(/font\/woff2;base64/g) || []).length === 2);
ok('with nothing left pointing at a path', !/url\(fonts\//.test(html));

// The one that matters: a real browser, offline for everything but the file.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const outside = [];
// Everything except the document itself is refused. A file that needs the
// network for its own typography would fail here, which is the point.
await ctx.route('**', (r) => {
  const u = r.request().url();
  if (u === 'https://itinerary.test/') return r.fulfill({ contentType: 'text/html', body: html });
  outside.push(u);
  return r.abort();
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('https://itinerary.test/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const seen = await page.evaluate(async () => {
  await document.fonts.ready;
  const got = async (spec) => {
    try { return (await document.fonts.load(spec)).length > 0; } catch (e) { return false; }
  };
  const h = document.querySelector('h1, h2');
  return {
    outfit: await got('700 24px Outfit'),
    jakarta: await got('400 16px Jakarta'),
    faces: [...document.fonts].map((f) => f.family + ':' + f.status),
    heading: h ? getComputedStyle(h).fontFamily : '',
    body: getComputedStyle(document.body).fontFamily,
  };
});

console.log('');
ok('no page errors', errs.length === 0, errs.join(' / '));
ok('Outfit resolves with the network cut off', seen.outfit, seen.faces.join(' | '));
ok('and so does Jakarta', seen.jakarta, seen.faces.join(' | '));
ok('headings ask for Outfit', /Outfit/.test(seen.heading), seen.heading);
ok('body asks for Jakarta', /Jakarta/.test(seen.body), seen.body);
ok('and it fetched no font from anywhere',
   !outside.some((u) => /woff|font/i.test(u)), outside.filter((u) => /woff|font/i.test(u)).join(' '));

await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/fontbaked.png' });
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
