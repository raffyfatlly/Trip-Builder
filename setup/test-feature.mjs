// The card at the top of the Trip page.
//
// raffy, 2026-09-02, of his Desaru trip: "in trip page do it like in the photo
// reference . now just photo no short description and some pill shape thingy".
//
// His Sorrento card has a heading, a paragraph and three pills. Desaru came out
// as a bare photograph — the schema requires the copy and the prompt insists on
// it, and the builder shipped one without anyway. So the card fills its own
// gaps from facts already on the page.
//
//   node setup/test-feature.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ORIGIN = 'https://itinerary.test';

const browser = await chromium.launch();
const open = async (T) => {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('**/api/photo**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return { ctx, page, errs };
};

// His Desaru card, verbatim: a picture and nothing else.
{
  const T = JSON.parse(JSON.stringify(REAL));
  T.trip.feature = { photo: 'x', credit: 'Desaru Beach', licence: 'CC BY-SA 4.0' };
  T.photos = { ...(T.photos || {}), x: '/api/photo?ref=places/a/photos/b' };
  T.stays = [
    { n: 'Mandarin Oriental, Desaru Coast', short: 'Mandarin Oriental', nights: '2 nights', dates: '20 to 22 Sep' },
    { n: 'Anantara Desaru Coast Resort & Villas', short: 'Anantara', nights: '2 nights', dates: '22 to 24 Sep' },
  ];

  const { ctx, page, errs } = await open(T);
  console.log('');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  const card = page.locator('#feature');
  ok('the card is not a bare photograph', (await card.locator('h2').count()) === 1);
  const h = await card.locator('h2').innerText();
  ok('the heading is the shape of the trip, in its own names',
     /Mandarin Oriental/.test(h) && /Anantara/.test(h), h);

  const pills = await card.locator('.fstats .pill').allInnerTexts();
  ok('it has the pills', pills.length === 3, pills.join(' | '));
  ok('counting the nights', pills.some((p) => /4 nights/i.test(p)), pills.join(' | '));
  ok('and the hotels', pills.some((p) => /2 hotels/i.test(p)), pills.join(' | '));
  ok('and the days', pills.some((p) => /days planned/i.test(p)), pills.join(' | '));

  // Every one of those is a fact already on the page. A description is
  // editorial, and a derived one would be filler — worse than none.
  ok('no invented description', (await card.locator('p').count()) === 0);
  await page.locator('#nav button[data-view="trip"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/feature-filled.png' });
  await ctx.close();
}

// A card the builder wrote properly must be left completely alone.
{
  const T = JSON.parse(JSON.stringify(REAL));
  T.trip.feature = {
    h: 'Sorrento first, then Positano',
    p: 'Six nights on the ground with only one hotel change.',
    stats: [{ icon: 'pin', text: '2 bases, 1 hotel change' }],
  };
  const { ctx, page, errs } = await open(T);
  console.log('');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a written heading is untouched',
     (await page.locator('#feature h2').innerText()) === 'Sorrento first, then Positano');
  ok('so is its paragraph', (await page.locator('#feature p').count()) === 1);
  ok('and its pills are not replaced with derived ones',
     (await page.locator('#feature .fstats .pill').allInnerTexts()).join('|') === '2 bases, 1 hotel change');
  await ctx.close();
}

// One base, and a trip with no stays at all.
{
  const one = JSON.parse(JSON.stringify(REAL));
  one.trip.feature = { photo: 'x' };
  one.photos = { x: '/api/photo?ref=places/a/photos/b' };
  one.stays = [{ n: 'Furama Resort Danang', short: 'Furama', nights: '1 night' }];
  const a = await open(one);
  console.log('');
  ok('one hotel reads in the singular',
     /1 night at Furama/i.test(await a.page.locator('#feature h2').innerText()),
     await a.page.locator('#feature h2').innerText());
  ok('and so does its pill',
     (await a.page.locator('#feature .fstats .pill').allInnerTexts()).some((p) => /1 hotel\b/i.test(p)));
  await a.ctx.close();

  const none = JSON.parse(JSON.stringify(REAL));
  none.trip.feature = { photo: 'x' };
  none.photos = { x: '/api/photo?ref=places/a/photos/b' };
  none.stays = [];
  const b = await open(none);
  ok('a trip with no stays still gets a pill rather than a bare photo',
     (await b.page.locator('#feature .fstats .pill').count()) > 0);
  ok('and does not claim a heading it cannot know',
     (await b.page.locator('#feature h2').count()) === 0);
  ok('no page errors', b.errs.length === 0, b.errs.join(' / '));
  await b.ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
