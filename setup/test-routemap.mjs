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


// Served from a real origin, not setContent. The map is requested as a
// relative /api/map, and a document at about:blank has no base to resolve it
// against — every image would fail for a reason the app will never hit.
const ORIGIN = 'https://itinerary.test';
const serve = async (ctx, html) => {
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
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
  await page.route('**/api/map**', (r) => {
    asked.push(r.request().url());
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);

  const pins = await page.locator('#routemap svg g').count();
  const tiles = await page.locator('#routemap img.ground').count();
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
  const url = asked.find((u) => u.includes('/api/map')) || '';
  const zoom = (/[?&]z=(\d+)/.exec(url) || [])[1];

  console.log('\n  — ' + label + ' (' + stays.length + ' stays, zoom ' + zoom + ')');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a styled map is requested from our own endpoint', !!url);
  ok('and the Google key is not in the page', !url.includes('key=') && !html.includes('AIza'));
  ok('exactly one ground image', tiles === 1);
  ok('one pin per stay', pins === stays.length, pins + ' pins');
  ok('every pin is inside the frame', inside === true);
  ok('the map has real size', !!box && box.width > 200 && box.height > 100,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'none');
  if (stays.length > 1) {
    // raffy, 2026-09-01: "remove tap a stop and in order from map." Both were
    // labelling what the picture already says, in the corners of the only
    // thing on the card worth looking at.
    ok('nothing floats over the map',
       (await page.locator('.rmap .rcap, .rmap .hint').count()) === 0);
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
  await page.route('**/api/map**', (r) => {
    z = (/[?&]z=(\d+)/.exec(r.request().url()) || [])[1];
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
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
  await page.route('**/api/map**', (r) => r.abort());
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);
  const box = await page.locator('#routemap .rmap').boundingBox();
  console.log('');
  ok('a dead map does not collapse the card', !!box && box.height > 120,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'zero height');
  ok('the pins survive it', (await page.locator('#routemap svg g').count()) === 2);
}

// A stay with a photo shows the photo, the way the Phu Quoc map does.
//
// raffy, 2026-09-01: "also possible to make map closer to how my phu quoc look?
// like the no 1 and 2 is the image of the hotel .if possible."
{
  const withPics = {
    ...REAL,
    photos: { h1: 'https://pics.test/1.jpg', h2: 'https://pics.test/2.jpg' },
    // One with a photo, one without: the second must keep the plain marker
    // rather than showing a grey hole where a picture should be.
    stays: [
      { ...stay('Furama', 16.0296, 108.2497), photo: 'h1' },
      { ...stay('Hoi An', 15.8801, 108.3380) },
    ],
  };
  const { html } = render(withPics, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('https://pics.test/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);

  console.log('');
  ok('a stay with a photo is drawn as the photo',
     (await page.locator('#routemap svg image').count()) === 1);
  ok('and it is the stay photo, not a map tile',
     (await page.locator('#routemap svg image').getAttribute('href')) === 'https://pics.test/1.jpg');
  ok('it is round, not a square stuck on the map',
     (await page.locator('#routemap svg clipPath circle').count()) === 1);
  ok('a stay with no photo keeps its marker',
     (await page.locator('#routemap svg g.pin').count()) === 2);
  ok('both are still tappable', (await page.locator('#routemap svg g.pin[role=button]').count()) === 2);
  // The frame has to make room for them, or the first stay sits half outside it.
  const inside2 = await page.evaluate(() => {
    const svg = document.querySelector('#routemap svg');
    const vb = svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll('g.pin')).every((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      const x = +m[1], y = +m[2];
      return x > 40 && y > 40 && x < vb.width - 40 && y < vb.height - 40;
    });
  });
  ok('and keeps them clear of the edges', inside2 === true);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/routemap-photos.png' });
  await ctx.close();
}

// Tapping a stop opens that stay.
{
  const { html } = render({ ...REAL, stays: TRIPS['two cities'] }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);
  ok('pins are marked up as buttons',
     (await page.locator('#routemap svg g.pin[role="button"]').count()) === 2);
  await page.locator('#routemap svg g.pin').nth(1).click();
  await page.waitForTimeout(500);
  const sheet = await page.locator('#sheet').innerText();
  ok('tapping the second pin opens the second stay', /Hoi An/.test(sheet), sheet.split('\n')[0]);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/routemap-no-tile.png' });
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
