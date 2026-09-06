// A saved trip has to keep its map.
//
// raffy, 2026-09-06: "just that I see the map background will be lost?" It
// would: the ground is one <img> pointing at /api/map on our server, so a file
// opened from disk asks file:///api/map and a PDF prints a blank rectangle.
//
//   node setup/test-mapbake.mjs

import fs from 'fs';
import zlib from 'zlib';
import assert from 'node:assert';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';
import { fitMap, groundQuery, mapPoints, mapfitJs, BAKE_W } from '../lib/mapfit.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('\nThe fit, which both sides must agree on');

const PTS = [{ lat: 18.7883, lon: 98.9853 }, { lat: 18.8045, lon: 98.9215 }];

t('a spread of points gets a centre between them', () => {
  const f = fitMap(PTS, 480, 640, 40, 40);
  assert.ok(f.cLat > 18.78 && f.cLat < 18.81, String(f.cLat));
  assert.ok(f.z >= 2 && f.z <= 15, String(f.z));
});
t('one point gets a city zoom, not a world one', () => {
  assert.equal(fitMap([PTS[0]], 480, 640, 40, 40).z, 12);
});
t('no points does not throw or centre on null island by accident', () => {
  const f = fitMap([], 480, 640, 40, 40);
  assert.equal(f.z, 12);
  assert.ok(Number.isFinite(f.cLat));
});
t('points far apart zoom out further than points close together', () => {
  const near = fitMap(PTS, 480, 640, 40, 40).z;
  const far = fitMap([{ lat: 3.1, lon: 101.7 }, { lat: 21.0, lon: 105.8 }], 480, 640, 40, 40).z;
  assert.ok(far < near, far + ' vs ' + near);
});

t('the shipped source is assigned, not a bare function statement', () => {
  // The minifier makes the export anonymous, and a bare "function(...)" is a
  // SyntaxError that takes the whole map script down. That shipped once.
  const src = mapfitJs();
  assert.ok(src.startsWith('var fitMap ='));
  assert.ok(!src.includes('`') && !src.includes('${'));
  const anon = src.replace('function fitMap(', 'function (');
  assert.doesNotThrow(() => new Function(anon));
  const run = new Function(anon + '\nreturn fitMap;')();
  assert.deepEqual(run(PTS, 480, 640, 40, 40), fitMap(PTS, 480, 640, 40, 40));
});

console.log('\nWhat the baker asks for');

t('every stay and planned item is fitted, not just the hotels', () => {
  const it = {
    stays: [{ lat: 18.78, lon: 98.98 }],
    days: [{ items: [{ lat: 19.2, lon: 98.5 }, { h: 'Pack tonight' }] }],
  };
  assert.equal(mapPoints(it).length, 2);
});
t('junk coordinates are dropped rather than dragging the map to sea', () => {
  const it = { stays: [{ lat: 'x', lon: 98.98 }, { lat: 18.78, lon: 98.98 }], days: [] };
  assert.equal(mapPoints(it).length, 1);
});
t('the query carries the centre and zoom the tile is drawn for', () => {
  const q = groundQuery(PTS, BAKE_W);
  assert.ok(/^-?\d+\.\d{5},-?\d+\.\d{5}$/.test(q.c), q.c);
  assert.equal(q.w, 480);
  assert.ok(q.z >= 2 && q.z <= 15);
});

console.log('\nIn the built app');

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const TRIP = JSON.parse(fs.readFileSync(
  '/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
TRIP.stays[0] = { ...TRIP.stays[0], lat: 16.0296, lon: 108.2497 };
TRIP.days = (TRIP.days || []).slice(0, 2).map((d, i) => ({
  ...d, items: [{ ...(d.items || [])[0], h: 'Stop ' + i, lat: 16.05 + i * 0.02, lon: 108.24 }],
}));

// A 2x2 red PNG, so "did it use the baked one" is answerable by looking.
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8'
  + 'z8Dwn4EIwDiqkL4KAdY2BAFVpS2GAAAAAElFTkSuQmCC';

const browser = await chromium.launch();
async function ground(trip) {
  // A fresh copy every time: render() is not promised to leave its input alone,
  // and the second call silently rendered a different trip when it shared one.
  const { html } = render(JSON.parse(JSON.stringify(trip)), tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let asked = false;
  // Served from a real origin rather than setContent: on about:blank a relative
  // "/api/map?..." has no base to resolve against, so the live branch could
  // never be exercised and the test looked like a product bug.
  await ctx.route('https://trip.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await ctx.route('**/api/map**', (r) => {
    asked = true;
    r.fulfill({ status: 200, contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
  });
  const p = await ctx.newPage();
  await p.goto('https://trip.test/', { waitUntil: 'load' });
  await p.locator('nav button, .tabbar button, [data-tab]')
    .filter({ hasText: /explore/i }).first().click({ force: true }).catch(() => {});
  await p.waitForSelector('#routemap img.ground', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  const src = await p.locator('#routemap img.ground').first().getAttribute('src').catch(() => null);
  await ctx.close();
  return { src, asked };
}

{
  const { src, asked } = await ground({ ...TRIP, ground: { url: RED, cLat: 16.04, cLon: 108.24, z: 12, w: 480 } });
  t('a baked trip draws its own ground', () => assert.equal(src, RED));
  t('and never calls the server for one', () => assert.equal(asked, false));
}
{
  const { src, asked } = await ground(TRIP);
  t('an unbaked trip still uses the live endpoint', () => {
    assert.ok(src && src.startsWith('/api/map?'), String(src));
    assert.ok(asked);
  });
}

await browser.close();
console.log('\n' + n + ' passed\n');
