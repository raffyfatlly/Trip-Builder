// Editing photos by hand: upload one, or paste a link.
//
//   BASE=http://localhost:3220 node setup/test-photoedit.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import { applyEdits } from '../lib/edits.js';

const B = process.env.BASE || 'http://localhost:3220';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the ops, offline ------------------------------------------------------
const base = {
  trip: { feature: { title: 'Sunset' } },
  stays: [{ n: 'Furama' }, { n: 'Second place' }],
  days: [{ items: [{ h: 'Coffee' }, { h: 'Dragon Bridge' }] }],
  photos: { built: 'https://example.com/agent.jpg' },
};
const URL_ = 'https://example.com/mine.jpg';

let r = applyEdits(base, [{ type: 'photo.set', target: 'item', day: 0, id: 'b0-1', url: URL_, credit: 'Mine' }]);
ok('an item photo lands on the right item', r.photos[r.days[0].items[1].photo] === URL_);
ok('and not on its neighbour', !r.days[0].items[0].photo);
ok('the caption comes with it', r.days[0].items[1].credit === 'Mine');
ok("the agent's own photos are untouched", r.photos.built === 'https://example.com/agent.jpg');

r = applyEdits(base, [
  { type: 'photo.set', target: 'stay', index: 1, url: URL_ },
  { type: 'photo.set', target: 'feature', url: 'https://example.com/hero.jpg' },
]);
ok('a stay photo lands on that stay', r.photos[r.stays[1].photo] === URL_);
ok('and the first stay is left alone', !r.stays[0].photo);
ok('the feature card takes one too', r.photos[r.trip.feature.photo] === 'https://example.com/hero.jpg');

r = applyEdits(base, [
  { type: 'photo.set', target: 'stay', index: 0, url: URL_ },
  { type: 'photo.set', target: 'stay', index: 0, url: 'https://example.com/better.jpg' },
]);
ok('replacing one does not leave the old behind',
   Object.keys(r.photos).filter((k) => k.startsWith('m-')).length === 1);

r = applyEdits(base, [
  { type: 'photo.set', target: 'item', day: 0, id: 'b0-0', url: URL_ },
  { type: 'photo.clear', target: 'item', day: 0, id: 'b0-0' },
]);
ok('clearing removes both the link and the reference',
   !r.days[0].items[0].photo && !Object.keys(r.photos).some((k) => k.startsWith('m-')));

// A photo op must not disturb the ordering work the other ops do.
r = applyEdits(
  { ...base, days: [{ items: [{ h: 'Late', t: '8:00pm' }, { h: 'Early', t: '9:00am' }] }] },
  [{ type: 'photo.set', target: 'item', day: 0, id: 'b0-0', url: URL_ }]);
ok('a photo edit does not re-sort the day', r.days[0].items[0].h === 'Late');

// --- the picker in a browser ----------------------------------------------
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
await ctx.route('**/api/session', (r2) => r2.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r2) => r2.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/state**', (r2) => r2.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: REAL, plan: {}, agentEdits: [], building: false, thinking: false, turns: 1 } }));

// A tiny real PNG, served so a pasted link genuinely resolves.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64');
await ctx.route('https://photos.test/ok.jpg', (r2) =>
  r2.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await ctx.route('https://photos.test/gone.jpg', (r2) => r2.fulfill({ status: 404, body: '' }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('header .itbtn').click();
await page.waitForTimeout(700);
await page.locator('.seg button:has-text("Edit")').click();
await page.waitForTimeout(500);

ok('the feature card can be given a photo', await page.locator('.pics .picrow').count() >= 2);
await page.locator('.pics .picrow').first().locator('.ppbtn').click();
await page.waitForTimeout(250);
ok('uploading is offered', await page.locator('.up:has-text("Upload from this device")').count() === 1);
ok('and so is a link', await page.locator('.ppin').first().count() === 1);
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/photopick.png' });

// A link that does not resolve must be refused, not silently accepted.
await page.locator('.ppin').first().fill('https://photos.test/gone.jpg');
await page.locator('.ppgo').click();
await page.waitForTimeout(1200);
ok('a dead link is refused', (await page.locator('.pperr').innerText()).includes('did not load'));

await page.locator('.ppin').first().fill('http://photos.test/ok.jpg');
await page.locator('.ppgo').click();
await page.waitForTimeout(400);
ok('and so is a non-https one', (await page.locator('.pperr').innerText()).includes('https://'));

await page.locator('.ppin').first().fill('https://photos.test/ok.jpg');
await page.locator('.ppin').nth(1).fill('The pool at Furama');
await page.locator('.ppgo').click();
await page.waitForTimeout(1200);
ok('a working link is accepted', await page.locator('.pperr').count() === 0);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('itin.edits.sesn_X') || '[]'));
ok('the edit is saved', stored.some((e) => e.type === 'photo.set' && e.url === 'https://photos.test/ok.jpg'));
ok('with the caption', stored.some((e) => e.credit === 'The pool at Furama'));
ok('the thumbnail shows what was chosen',
   (await page.locator('.pics .picrow').first().locator('img.thumb').getAttribute('src')) === 'https://photos.test/ok.jpg');
ok('and it can be taken off again', await page.locator('.pics .picrow').first().locator('.pprem').count() === 1);

// It has to survive a reload — an edit that vanishes is worse than no edit.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('header .itbtn').click();
await page.waitForTimeout(600);
await page.locator('.seg button:has-text("Edit")').click();
await page.waitForTimeout(400);
ok('the photo is still there after a reload',
   (await page.locator('.pics .picrow').first().locator('img.thumb').count()) === 1);

ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
