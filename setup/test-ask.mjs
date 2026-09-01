// Changing something by saying what you want.
//
// raffy, 2026-09-01: "the whole editing manually also a concern to me .
// doesn't feel seamless. not streamline. not intuitive."
//
// The fix is about which gesture comes first. Tapping an item used to open a
// five-field form; it now opens a sentence, and the form is one tap further
// down. So the things worth guarding are: the sentence is what you get first,
// it reaches the agent with enough context to act on ("which item, which day"),
// a chip fills the box rather than firing, and the form is still reachable.
//
//   BASE=http://localhost:3220 node setup/test-ask.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const B = process.env.BASE || 'http://localhost:3220';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errs = [];
const sent = [];

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_A' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: REAL, plan: {}, agentEdits: [], building: false, thinking: false, turns: 1 } }));
await ctx.route('**/api/send', (r) => {
  sent.push(JSON.parse(r.request().postData() || '{}'));
  r.fulfill({ json: { ok: true } });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('header .itbtn').click();
await page.waitForTimeout(700);
await page.locator('.seg button:has-text("Edit")').click();
await page.waitForTimeout(500);

const first = page.locator('.editor .card').first();
const heading = (await first.locator('.h').innerText()).trim();
await first.click();
await page.waitForTimeout(300);

ok('tapping an item asks what you want', await page.locator('.ask textarea').count() === 1);
ok('the form is not what you get first', await page.locator('.ed .field').count() === 0);
ok('it names the thing you tapped', (await page.locator('.ask .who b').innerText()).trim() === heading);
ok('and offers the usual asks', await page.locator('.ask .chip').count() >= 4);

// A chip fills the box. Tapping one and then adding "but keep it before
// dinner" is the normal case, and a chip that sends immediately kills it.
await page.locator('.ask .chip:has-text("Later in the day")').click();
await page.waitForTimeout(150);
ok('a chip fills the box rather than sending', sent.length === 0);
ok('and the box holds it', (await page.locator('.ask textarea').inputValue()) === 'Later in the day');

await page.locator('.ask textarea').fill('Later in the day, but before dinner');
await page.locator('.ask .go').click();
await page.waitForTimeout(500);

ok('asking sends one message', sent.length === 1, JSON.stringify(sent.map((x) => x.text)));
const msg = (sent[0] || {}).text || '';
ok('it says which item', msg.includes(heading), msg);
ok('it says which day', /on \w+ \d+:/.test(msg), msg);
ok('and it carries what you typed', msg.includes('Later in the day, but before dinner'), msg);
ok('nothing was edited locally',
   (await page.evaluate(() => JSON.parse(localStorage.getItem('itin.edits.sesn_A') || '[]'))).length === 0);
ok('and it takes you back to the chat', await page.locator('.pane.open').count() === 0);

// The form is still there for when you know the words you want.
await page.locator('header .itbtn').click();
await page.waitForTimeout(600);
await page.locator('.seg button:has-text("Edit")').click();
await page.waitForTimeout(400);
await page.locator('.editor .card').first().click();
await page.waitForTimeout(250);
await page.locator('.foot button:has-text("Edit the details myself")').click();
await page.waitForTimeout(250);
ok('the form is one tap down', await page.locator('.ed .field').count() >= 3);
ok('and it still saves by hand', await page.locator('.ed .save').count() === 1);
await page.locator('.ed input').first().fill('7:15am');
await page.locator('.ed .save').click();
await page.waitForTimeout(300);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('itin.edits.sesn_A') || '[]'));
ok('a hand edit is still a local op', stored.some((e) => e.type === 'item.update' && e.patch.t === '7:15am'),
   JSON.stringify(stored));

// Adding leads with the sentence too.
await page.locator('.editor .add').click();
await page.waitForTimeout(250);
ok('adding asks as well', await page.locator('.ask textarea').count() === 1);
await page.locator('.ask textarea').fill('somewhere for lunch near the hotel');
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/ask.png' });
await page.locator('.ask .go').click();
await page.waitForTimeout(400);
ok('and it says which day to add to', /^Add to \w+ \d+: somewhere for lunch/.test((sent[1] || {}).text || ''),
   (sent[1] || {}).text);

ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
