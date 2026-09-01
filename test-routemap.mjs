// The map, at every scale a trip can have.
//
// raffy, 2026-09-01: "would it be too hard to do the map like in phu quoc ? i
// really wish they have that map too like mine. it look nice." Then, catching
// the hard part himself: "but the map will cover their destination journey. u
// know what i mean? lke what if they go to two countries."
//
// The Phu Quoc map is hand-drawn and describes one island at one zoom. This
// one computes its zoom from the stays, so the same component has to survive
// one hotel, one city, and Kuala Lumpur to Hanoi. That is what is checked here.
//
//   node setup/test-routemap.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const stay = (n, lat, lon) => ({ ...REAL.stays[0], n, short: n, lat, lon });

const TRIPS = {
  'one city': [stay('Furama', 16.0296, 108.2497)],
  'two cities': [stay('Furama', 16.0296, 108.2497), stay('Hoi An', 15.8801, 108.3380)],
  'two countries': [
    stay('Kuala Lumpur', 3.1390, 101.6869),
    stay('Bangkok', 13.7563, 100.5018),
    stay('Hanoi', 21.0278, 105.8342),
  ],
  'two continents': [stay('Kuala Lumpur', 3.1390, 101.6869), stay('Rome', 41.9028, 12.4964)],
};

const browser = await chromium.launch();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

for (const [label, stays] of Object.entries(TRIPS)) {
  const { html } = render({ ...REAL, stays }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const asked = [];
  await page.route('**basemaps.cartocdn.com**', (r) => {
    asked.push(r.request().url());
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);

  const pins = await page.locator('#routemap svg g').count();
  const tiles = await page.locator('#routemap img.tile').count();
  const box = await page.locator('#routemap .rmap').boundingBox();
  // Every pin has to land inside the picture, which is the thing that breaks
  // when the zoom is wrong.
  const inside = await page.evaluate(() => {
    const svg = document.querySelector('#routemap svg');
    if (!svg) return null;
    const vb = svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll('g')).every((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      if (!m) return false;
      const x = +m[1], y = +m[2];
      return x > 8 && y > 8 && x < vb.width - 8 && y < vb.height - 8;
    });
  });
  const url = asked.find((u) => u.includes('cartocdn')) || '';
  const zoom = (/light_all\/(\d+)\//.exec(url) || [])[1];

  console.log('\n  — ' + label + ' (' + stays.length + ' stays, zoom ' + zoom + ')');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('map tiles are requested', !!url);
  ok('and enough of them to cover the frame', tiles >= 6, tiles + ' tiles');
  ok('one pin per stay', pins === stays.length, pins + ' pins');
  ok('every pin is inside the frame', inside === true);
  ok('the map has real size', !!box && box.width > 200 && box.height > 100,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'none');
  if (stays.length > 1) {
    ok('the stays are numbered in a legend',
       (await page.locator('#routemap .rleg').count()) === stays.length);
  }
  await page.screenshot({ path: 'shots/routemap-' + label.replace(/ /g, '-') + '.png' });
  await ctx.close();
}

// Zoom has to actually respond to the spread, or it is not solving anything.
const zoomOf = async (stays) => {
  const { html } = render({ ...REAL, stays }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  let z = null;
  await page.route('**basemaps.cartocdn.com**', (r) => {
    z = (/light_all\/(\d+)\//.exec(r.request().url()) || [])[1];
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);
  await ctx.close();
  return +z;
};
const near = await zoomOf(TRIPS['two cities']);
const far = await zoomOf(TRIPS['two continents']);
console.log('');
ok('a wider trip zooms out further', far < near, 'two cities z' + near + ' vs two continents z' + far);

// The tile failing is the common case in the wild — a slow network, a blocked
// host, an offline phone. It must not take the map down with it: that looked
// exactly like the feature had never shipped, and cost an evening of hunting
// for a deploy problem that did not exist.
{
  const { html } = render({ ...REAL, stays: TRIPS['two cities'] }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**basemaps.cartocdn.com**', (r) => r.abort());
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);
  const box = await page.locator('#routemap .rmap').boundingBox();
  console.log('');
  ok('a dead tile does not collapse the map', !!box && box.height > 120,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'zero height');
  ok('the pins survive it', (await page.locator('#routemap svg g').count()) === 2);
  await page.screenshot({ path: 'shots/routemap-no-tile.png' });
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
