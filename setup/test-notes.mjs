// A note that says "not booked" must stop saying that once you confirm the
// booking. Before this it never went away — confirming flipped stay.draft, but
// the "Before you lock this in" prose the builder wrote was static text with
// no connection back to that flag.
//
//   BASE=http://localhost:3260 node setup/test-notes.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const B = process.env.BASE || 'http://localhost:3260';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const ITIN = {
  ...REAL,
  stays: [{ ...REAL.stays[0], draft: true }, ...REAL.stays.slice(1)],
  trip: {
    ...REAL.trip,
    notes: [
      { kind: 'warn', h: 'Stay 1 is not booked.', p: 'Everything here assumes Furama.', stay: 0 },
      { kind: 'info', h: 'September is shoulder season.', p: 'Prices may still move.' },
    ],
  },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: ITIN, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('.itbtn').click();
await page.waitForTimeout(700);
await page.locator('.seg button:has-text("Preview")').click();
await page.waitForTimeout(600);

const frame = page.frameLocator('.phone iframe');
const foot = () => frame.locator('#foot').innerText();

ok('the caveat shows before the stay is confirmed', (await foot()).includes('Stay 1 is not booked'));
ok('an untagged note is unaffected either way', (await foot()).includes('shoulder season'));
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/notes-before.png' });

await page.locator('.seg button:has-text("Edit")').click();
await page.waitForTimeout(500);
await page.locator('.stayrow button:has-text("Confirm")').click();
await page.waitForTimeout(500);
await page.locator('.seg button:has-text("Preview")').click();
await page.waitForTimeout(700);

ok('confirming the stay clears its note', !(await foot()).includes('Stay 1 is not booked'));
ok('and leaves the general note alone', (await foot()).includes('shoulder season'));
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/notes-after.png' });

// The other stay-status card — the inline one on the day itself — was already
// reactive before this fix. Confirming should not have broken it.
ok('the inline day-level notice also clears',
   !(await frame.locator('body').innerText()).includes('This stay is not booked yet'));

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
