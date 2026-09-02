// A trip somebody drives to.
//
// raffy, 2026-09-02, of his Desaru trip: "its road trip right , but in my trip
// page it still has that flight section. can't it able to make it so if its
// road trip then there's no flight section or change in to car instead of
// flight?"
//
// The trip already said arriveBy "drive". The builder then filled the flights
// array with the drive legs anyway — Kuala Lumpur to Desaru Coast, no times —
// and the page believed the array over the field. Reading a list as an answer
// to a question the trip has already answered outright is how a road trip ends
// up with a departure gate.
//
//   node setup/test-driving.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ORIGIN = 'https://itinerary.test';

// His Desaru legs, verbatim from the session.
const DRIVE = [
  { dir: 'out', from: 'Kuala Lumpur', to: 'Desaru Coast', day: 'SUN 20', lat: 1.53087, lon: 104.27669, fromLat: 3.139, fromLon: 101.6869 },
  { dir: 'back', from: 'Desaru Coast', to: 'Kuala Lumpur', day: 'THU 24' },
];

const browser = await chromium.launch();
const open = async (T) => {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="trip"]').click();
  await page.waitForTimeout(400);
  return { ctx, page, errs };
};

{
  const T = JSON.parse(JSON.stringify(REAL));
  T.trip.arriveBy = 'drive';
  T.trip.flights = DRIVE;
  const { ctx, page, errs } = await open(T);
  console.log('');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  const head = await page.locator('#flights-sect h2').innerText();
  ok('the section is not called Flights', !/flight/i.test(head), head);
  ok('it is called what it is', /getting there/i.test(head), head);

  // The drive has no departure time, and the page said so out loud.
  const card = await page.locator('#flights').innerText();
  ok('and nothing on it reads "undefined"', !/undefined/i.test(card), card.replace(/\n/g, ' | '));
  ok('the legs are still there', /Kuala Lumpur/.test(card) && /Desaru Coast/.test(card));

  ok('the header does not say they fly',
     !/until you fly/i.test(await page.locator('body').innerText()));

  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/driving.png' });
  await ctx.close();
}

{
  // A trip that really does fly must be untouched.
  const T = JSON.parse(JSON.stringify(REAL));
  T.trip.arriveBy = 'fly';
  T.trip.flights = [{ dir: 'out', from: 'KUL', to: 'DAD', day: 'THU 10', dep: '06:40', arr: '08:05' }];
  const { ctx, page, errs } = await open(T);
  console.log('');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a flown trip still says Flights', /flights/i.test(await page.locator('#flights-sect h2').innerText()));
  ok('with its times intact', /06:40/.test(await page.locator('#flights').innerText()));
  ok('and the header says they fly', /until you fly/i.test(await page.locator('body').innerText()));
  await ctx.close();
}

{
  // Nothing said either way: fall back to whether there are flights at all.
  const T = JSON.parse(JSON.stringify(REAL));
  delete T.trip.arriveBy;
  T.trip.flights = [{ dir: 'out', from: 'KUL', to: 'DAD', day: 'THU 10', dep: '06:40' }];
  const a = await open(T);
  console.log('');
  ok('an unstated trip with flights still says Flights',
     /flights/i.test(await a.page.locator('#flights-sect h2').innerText()));
  await a.ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
