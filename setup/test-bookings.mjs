// The Wallet.
//
// raffy, 2026-09-01: "im not happy with the booking tab .feels superficial
// especially like its an app."
//
// The first version drew the same stays the Trip tab draws, with a badge on
// them. It held nothing you could not already see. What makes a wallet a
// wallet is holding the actual confirmation — the reference you read out at a
// counter — so these tests are about records, not about the plan.
//
// Also guarded, from the first build of this tab: it must land as a SIBLING of
// the other views. The original marker swallowed the </section> that closes the
// day view, so Bookings nested inside Days, inherited [hidden], and rendered at
// zero height while cheerfully reporting display:block.
//
//   node setup/test-bookings.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

const STAYS = [
  { ...REAL.stays[0] },
  { ...REAL.stays[0], n: 'La Siesta Hoi An', short: 'La Siesta', dates: '12 to 14 Sep', nights: '2 nights', draft: true },
];

// Served from a real origin: setContent leaves the document at about:blank,
// where the clipboard API is not available and relative URLs have no base.
const ORIGIN = 'https://itinerary.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch();

async function open(T, perms) {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true,
    permissions: perms || [],
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('#nav button[data-view="book"]').click();
  await page.waitForTimeout(300);
  return { ctx, page, errs, text: () => page.locator('#bookings').innerText() };
}

// --- a wallet with things in it ---------------------------------------------
{
  const T = {
    ...REAL,
    stays: STAYS,
    trip: { ...REAL.trip, flights: [{ from: 'KUL', to: 'DAD', code: 'AK1494', date: '10 Sep', dep: '06:40' }] },
    bookings: [
      { id: 'bk1', at: 1, kind: 'flight', title: 'AirAsia AK1494, KUL to DAD', ref: 'QK7T2P',
        when: '10 Sep, 06:40', where: 'KLIA2', note: 'Check-in opens 48h before. 20kg each.' },
      { id: 'bk2', at: 2, kind: 'stay', title: 'La Siesta Hoi An', ref: 'HB-99231',
        when: '12 to 14 Sep', stay: 1 },
    ],
  };
  const { ctx, page, errs, text } = await open(T, ['clipboard-read', 'clipboard-write']);
  const t = await text();

  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('the nav has four tabs', await page.locator('#nav button').count() === 4);
  ok('the wallet tab is short', (await page.locator('#nav button[data-view="book"]').innerText()).trim() === 'Wallet');
  ok('the wallet is its own view, not nested', await page.locator('#v-book').isVisible());
  ok('and it has real height', (await page.locator('#v-book').boundingBox()).height > 300);

  // The whole point: the record, not the plan.
  ok('a filed booking is the content', t.includes('AirAsia AK1494'));
  ok('its reference is on the card', t.includes('QK7T2P'));
  ok('the one thing worth remembering is kept', t.includes('Check-in opens 48h'));
  ok('confirmed comes first', t.indexOf('Confirmed') < t.indexOf('Still to sort'));

  // The traveller told us this flight once and filed it once. Twice is a bug.
  const codes = (t.match(/AK1494/g) || []).length;
  ok('the flight is not listed twice', codes === 1, codes + ' mentions');

  // A booking that names a stay takes it off the outstanding list.
  const under = t.slice(t.indexOf('Still to sort'));
  ok('the filed stay is off the to-do list', !under.includes('La Siesta'));
  ok('the unfiled stay is still on it', under.includes('Furama'));
  // innerText comes back through text-transform:uppercase, so match loosely.
  ok('a booked stay with no paperwork says so', /no confirmation filed/i.test(under));
  ok('it counts what is sorted', /2 of 3 sorted/.test(t), t.split('\n')[0]);

  // Copying is what you actually do with a reference at a counter.
  await page.locator('.bkref').first().click();
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('tapping the reference copies it', clip === 'QK7T2P', JSON.stringify(clip));
  ok('and it says it did', /copied/i.test(await page.locator('.bkref').first().innerText()));

  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/bookings.png' });
  await ctx.close();
}

// --- an empty wallet ---------------------------------------------------------
{
  const T = { ...REAL, stays: STAYS };
  const { ctx, errs, text } = await open(T);
  const t = await text();
  ok('empty: no page errors', errs.length === 0, errs.join(' / '));
  ok('empty: it asks for a confirmation', t.includes('Nothing filed yet'));
  ok('empty: it says how to send one', /forward/i.test(t));
  ok('empty: the draft stay still reads as not booked', t.includes('La Siesta') && /not booked/i.test(t));
  ok('empty: nothing is sorted yet', /0 of 3 sorted/.test(t), t.split('\n')[0]);
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
