// A missing optional field must not take the whole app down.
//
// raffy, 2026-09-07: "check my recent Jakarta trip. and doesn't give the list
// in photos like before at all. and suddenly it give this" — a white page
// reading "Application error: a client-side exception has occurred" — and then,
// crucially, "the error only on Jakarta page. other page is okay."
//
// That last line is the whole diagnosis. It was never the code path; it was the
// data. The app's script does:
//
//     var AREAS=T.areas;
//     ...
//     AREAS.forEach(function(a){ ... });
//
// A trip whose ideas happen to be grouped carries `areas` and works. A trip
// whose ideas are one flat list carries no `areas` at all, `AREAS` is
// undefined, and the forEach throws at the TOP LEVEL of the only script in the
// document — so it did not merely lose the idea grid, it killed the day strip,
// the map, the packing list and everything after it.
//
// setup/test-ideas.mjs already covered `areas: []`. It never covered `areas`
// being ABSENT, which is a different value and the one that crashed. This
// covers every collection the template dereferences without asking.
//
//   node setup/test-thinfields.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();

// Shaped like the Jakarta trip that broke: real days, a stay, one ungrouped
// idea, and no `areas` key anywhere.
const JAKARTA = {
  trip: {
    id: 'jkt', who: 'raffy', title: 'Jakarta', titleSub: 'four nights', sub: 'Your trip',
    flag: '\u{1F1EE}\u{1F1E9} Indonesia', start: '2026-11-12', end: '2026-11-16',
    tzOffsetMin: 420, theme: 'sage', statePill: '4 nights',
    heroChips: [{ icon: 'cal', text: '12 to 16 Nov' }], travellers: [{ name: 'Raffy' }],
  },
  stays: [{
    n: 'Ashley Wahid Hasyim', short: 'Ashley', side: 'Menteng', dates: '12 to 16 Nov',
    nights: '4 nights', loc: 'Menteng', ci: '3:00pm', co: '12:00pm',
    lat: -6.19, lon: 106.82, photo: 'p1',
  }],
  days: [
    { dow: 'THU', dom: 12, stay: 0, title: 'Arrive', sub: 'Land and eat',
      items: [{ h: 'Flight to CGK', t: '09:00', icon: 'sun' },
        { h: 'Dinner at Bakmi GM', t: '19:00', icon: 'sun', photo: 'p2' }] },
    { dow: 'FRI', dom: 13, stay: 0, title: 'Old town', sub: 'Kota Tua',
      items: [{ h: 'Kota Tua', t: '10:00', icon: 'sun', photo: 'p3' }] },
  ],
  ideas: [{ n: 'Ragunan Zoo', verdict: 'maybe', one: 'Big, cheap, hot', time: '3 hours', icon: 'sun', photo: 'p4' }],
  photos: { p1: '/api/photo?ref=x1', p2: '/api/photo?ref=x2', p3: '/api/photo?ref=x3', p4: '/api/photo?ref=x4' },
  // NOTE: no `areas`. That is the bug, reproduced.
};

const ORIGIN = 'https://itinerary.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch();

const open = async (T) => {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await ctx.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('**/api/photo**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  return { ctx, page, errs };
};

// The trip that broke, exactly as stored.
{
  const { ctx, page, errs } = await open(JAKARTA);
  ok('a trip with no areas key throws nothing', errs.length === 0, errs.join(' / '));
  // The crash was fatal, not local: prove the things AFTER the ideas block drew.
  ok('the idea still renders as a card', (await page.locator('#ideas .ideacard').count()) === 1);
  ok('the day strip survived it', (await page.locator('#strip').count()) > 0
    && (await page.locator('#strip').innerText()).includes('12'));
  await page.screenshot({ path: 'shots/thin-jakarta.png' });
  await ctx.close();
}

// Every other collection the template dereferences, one at a time. Each of
// these is `input.x || []` in save_itinerary, so a trip built today has them —
// but stored trips predate that and are never rebuilt.
for (const k of ['areas', 'ideas', 'stays', 'days', 'photos']) {
  const T = { ...JAKARTA };
  delete T[k];
  const { ctx, page, errs } = await open(T);
  ok('renders with no `' + k + '`', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

// And the degenerate case: a trip that is only a trip.
{
  const { ctx, page, errs } = await open({ trip: JAKARTA.trip });
  ok('renders with nothing but a trip header', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' failed' : '\nall good');
process.exit(fail ? 1 : 0);
