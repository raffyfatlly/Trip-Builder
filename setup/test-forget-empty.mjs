// Backing out of a session with nothing in it forgets it, so it is never
// quietly resumed later — an empty session looks identical to no session at
// all, so nothing real is ever at risk.
//
//   BASE=http://localhost:3241 node setup/test-forget-empty.mjs
//
// raffy, 2026-09-16: "for when in session, clear it if they back from the
// session. only signup content is kept."

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let sessionsCreated = 0;
await ctx.route('**/api/session', (r) => {
  sessionsCreated++;
  r.fulfill({ json: { session: 'sesn_' + sessionsCreated } });
});
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.locator('.ob').waitFor({ state: 'visible', timeout: 5000 });
ok('a fresh visit mints a session', sessionsCreated === 1, String(sessionsCreated));

const key = await page.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('and stores it', key === 'sesn_1', key);

// Backing out with nothing sent forgets it.
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const after = await page.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('an empty session is forgotten on the way out', after === null, String(after));

// The next visit starts clean rather than resuming the forgotten one.
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.ob').waitFor({ state: 'visible', timeout: 5000 });
ok('the next visit mints a NEW session rather than resuming the old one',
   sessionsCreated === 2, String(sessionsCreated));
const key2 = await page.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('and that one is what gets stored', key2 === 'sesn_2', key2);

ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
