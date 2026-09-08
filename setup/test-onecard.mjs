// One place, shown as a card rather than a paragraph.
//
//   BASE=http://localhost:3241 node setup/test-onecard.mjs
//
// raffy, 2026-09-08: "if they are presenting one place (hotel, flight,
// attraction) create a nice looking card like the list card too. like i said
// visual is important especially if that's the first time it recommend."
//
// The rule said "naming TWO OR MORE of anything means a card set", which the
// agent read — reasonably — as permission to describe a single recommendation
// in prose. The first thing somebody sees of a place decides whether they want
// it, and a paragraph is a worse first impression than a photograph.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { blockFrom } from '../lib/blocks.js';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const ONE = {
  kind: 'options', title: 'Where I would put you', choose: true,
  intro: 'One place, and the reason it is the one.',
  items: [{
    name: 'Banyan Tree Bangkok',
    why: 'Rooftop bar with the best view in the city, and a five-minute walk to the BTS.',
    price: 'RM543/night',
    rating: '4.8 on Google, 16,933 reviews',
    tags: ['5 min to BTS Sathorn', 'Rooftop pool', 'Free cancellation'],
    source: 'Google Hotels, checked just now',
    links: [{ label: 'Book on Booking.com', url: 'https://www.booking.com/searchresults.html?ss=Banyan+Tree+Bangkok' }],
  }],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
// The hotel has a photograph; the flight does not. Both cases matter, and they
// are the difference between a card that sells the place and an empty square.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64');
let hasPhoto = true;
await ctx.route('**/api/place**', (r) => r.fulfill({ json: hasPhoto
  ? { photo: '/api/photo?x=1', rating: '4.8', maps: 'https://maps.google.com/?q=x' }
  : null }));
await ctx.route('**/api/photo**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [
    { role: 'user', text: 'where should i stay in bangkok', id: 'u1' },
    { ...blockFrom({ id: 'b1', name: 'present', input: ONE }) },
    { role: 'assistant', text: 'That is the one I would book.', id: 'a1' },
  ],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const card = page.locator('.opt').first();
ok('one item still draws a full card', await card.count() === 1);
ok('open, not collapsed into a row', await page.locator('.opt.row').count() === 0);
ok('with the picture', await card.locator('img, .pic').count() >= 1);
ok('the name', (await card.innerText()).includes('Banyan Tree Bangkok'));
ok('the price', (await card.innerText()).includes('RM543'));
ok('the hard facts as pills', await card.locator('.tags span').count() === 3);
ok('where it came from', (await card.innerText()).toLowerCase().includes('google hotels'));
ok('and something to do about it', await card.locator('.acts button').count() >= 1);

const text = await card.innerText();
ok('it reads as a recommendation, not a menu of one',
   text.includes('Choose this') || text.includes('Tell me more'), text.split('\n').pop());

await page.screenshot({ path: 'shots/one-card.png', fullPage: false });
// A FLIGHT, which is the case raffy asked to see: "try on flight ticket lemme
// see". Same card, different content — and the interesting question is what a
// photograph means for something that is not a place.
{
  const FLIGHT = {
    kind: 'options', title: 'The flight I would take', choose: true,
    intro: 'KL to Bangkok, 20 September.',
    items: [{
      name: 'Malaysia Airlines MH780',
      why: 'Direct, lands early enough for dinner, and the only one on the day with a proper cabin bag allowance.',
      price: 'RM1,536 return',
      meta: 'Departs 09:45, arrives 10:55',
      tags: ['Direct', '2h 10m', '7kg cabin bag', 'KLIA Terminal 1'],
      source: 'Google Flights, checked just now — usual range RM840-1,050',
      links: [{ label: 'Book on Google Flights', url: 'https://www.google.com/travel/flights?q=Flights%20from%20KUL%20to%20BKK' }],
    }],
  };
  // Places has no photograph of MH780 and never will, which is the point.
  hasPhoto = false;
  await ctx.unroute('**/api/state**');
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [
      { role: 'user', text: 'find me the flight', id: 'u2' },
      { ...blockFrom({ id: 'b2', name: 'present', input: FLIGHT }) },
      { role: 'assistant', text: 'That is the one I would book.', id: 'a2' },
    ],
    itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 2 } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const f = page.locator('.opt').first();
  ok('a flight draws the same card', await f.count() === 1);
  ok('with the fare', (await f.innerText()).includes('RM1,536'));
  ok('the times', (await f.innerText()).includes('09:45'));
  ok('what makes it the one', (await f.innerText()).includes('Direct'));
  ok('and where the price came from',
     (await f.innerText()).toLowerCase().includes('google flights'));
  // The two things a flight card must NOT carry: an empty photo tile where a
  // picture would go, and an offer to show it on a map.
  ok('no empty picture box where there is no picture',
     await f.locator('.pic').count() === 0);
  ok('and no map link for something that is not a place',
     await f.locator('.mapl').count() === 0);
  await page.screenshot({ path: 'shots/one-card-flight.png' });
}

// The rule itself, since the card only gets drawn if the agent sends one.
{
  const { SYSTEM } = await import('../lib/prompt.js');
  const { HOUSE_RULES } = await import('../lib/context.js');
  ok('the prompt says one place is also a card', /ONE PLACE IS ALSO A CARD/.test(SYSTEM));
  ok('and says why — the first sight decides', /first sight of a place/.test(SYSTEM));
  // A session pins the agent version it was born on, so the system prompt only
  // reaches NEW chats. The per-message house rules are what reach a
  // conversation already running, and they have to agree.
  ok('and the per-message rules agree, for chats already open',
     /ONE place counts/.test(HOUSE_RULES), HOUSE_RULES.slice(0, 80));
}

ok('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
