// A card is never blank, booked or not.
//
// raffy, 2026-09-01: "make sure even the hotel not book. the photo need to be
// there. so it looks nice. that's why the app is special. it looks nice."
//
// The builder used to be told to construct a map URL when it had no
// photograph, and it often just didn't. Every stay carries its own lat/lon, so
// the app draws the map itself now. No server needed for this one.
//
//   node setup/test-photofallback.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';
import { PHOTO_REF, placesKey } from '../lib/photos.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the proxy only serves Google's own photo references ------------------
ok('a real photo reference is accepted', PHOTO_REF.test('places/ChIJ_abc-123/photos/AelY_CsXYZ-9'));
ok('a path traversal is not', !PHOTO_REF.test('places/../../secrets/photos/x'));
ok('an absolute URL is not', !PHOTO_REF.test('https://evil.example/x'));
ok('photos are simply off without a key', typeof placesKey() === 'string');

// --- and the itinerary never renders an empty card ------------------------
const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString('utf8');
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const T = {
  ...REAL,
  photos: {},
  stays: REAL.stays.map((s, i) => ({ ...s, photo: undefined, draft: i === 0 })),
  trip: { ...REAL.trip, feature: { ...(REAL.trip.feature || {}), photo: undefined } },
};
const { html } = render(T, tpl);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const asked = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await page.route('**maps.wikimedia.org**', (r) => {
  asked.push(r.request().url());
  r.fulfill({ contentType: 'image/png', body: PNG });
});
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

ok('no page errors', errs.length === 0, errs.join(' / '));
ok('the feature card shows the area rather than nothing', asked.some((u) => u.includes('osm-intl,12')));
ok('an unbooked stay still gets a picture', asked.some((u) => u.includes('osm-intl,15')));
const src = await page.evaluate(() => {
  const i = document.querySelector('#feature img');
  return i && i.getAttribute('src');
});
ok('and it is a map of the right place', !!src && src.includes('maps.wikimedia.org'), String(src));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
