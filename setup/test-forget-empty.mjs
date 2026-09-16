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

// The actual bug report: "I still get my old session in chat. (I'm not
// signed in) clear that." A session with REAL content but no account
// behind it — on a deployment WITH accounts — must be forgotten too, not
// just an empty one. A signed-in session must NOT be forgotten: the
// account is its safety net, but there is no reason to throw it away
// every time regardless.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
let sessions2 = 0;
await ctx2.route('**/api/session', (r) => { sessions2++; r.fulfill({ json: { session: 'anon_' + sessions2 } }); });
await ctx2.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: null } }));
await ctx2.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx2.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'an old test question', id: 'u1' },
    { role: 'assistant', text: 'an old test answer', id: 'a1' }],
  party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));
const page2 = await ctx2.newPage();
await page2.goto(B, { waitUntil: 'networkidle' });
await page2.locator('.msg').first().waitFor({ state: 'visible', timeout: 5000 });
ok('an anonymous session with real content still shows normally while the tab is open',
   (await page2.locator('.msg').first().innerText()).includes('old test question'));

await page2.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const afterAnon = await page2.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('but it is forgotten on the way out, unsigned in, even with real content',
   afterAnon === null, String(afterAnon));

// A signed-in session with the same content must survive the same event.
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx3.route('**/api/session', (r) => r.fulfill({ json: { session: 'signedin_1' } }));
await ctx3.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'raffy.fatlly@gmail.com' } } }));
await ctx3.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx3.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'a real trip question', id: 'u1' }],
  party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: 'raffy.fatlly@gmail.com' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));
const page3 = await ctx3.newPage();
await page3.goto(B, { waitUntil: 'networkidle' });
await page3.locator('.msg').first().waitFor({ state: 'visible', timeout: 5000 });
await page3.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const afterSignedIn = await page3.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('a signed-in session survives the same event untouched',
   afterSignedIn === 'signedin_1', String(afterSignedIn));

// public/welcome/index.html's "Plan a trip" now links to /?new=1, not a
// bare /. raffy, 2026-09-16, with a screenshot: "i still see my past
// session (not signed in) when i click plan trip." — a stale anonymous
// session sitting in localStorage from an earlier round (never properly
// left, so the pagehide-forget above never ran) was resumed exactly as if
// current. ?new=1 tells the bootstrap effect to ignore whatever KEY holds
// and always mint a fresh session — which then makes the required sign-up
// dialog below fire too, for free, since a brand new session always starts
// at zero messages.
const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
try { await ctx4.addInitScript((v) => localStorage.setItem('itin.session.v1', v), 'stale_old_1'); } catch (e) { /* ignore */ }
let sessions4 = 0;
await ctx4.route('**/api/session', (r) => { sessions4++; r.fulfill({ json: { session: 'fresh_' + sessions4 } }); });
await ctx4.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: null } }));
await ctx4.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx4.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
const page4 = await ctx4.newPage();
await page4.goto(B + '/?new=1', { waitUntil: 'networkidle' });
await page4.waitForTimeout(500);
ok('?new=1 mints a brand new session rather than the stale one already in localStorage',
   sessions4 === 1, String(sessions4));
const key4 = await page4.evaluate(() => localStorage.getItem('itin.session.v1'));
ok('and that new session id is what gets stored, not the stale one', key4 === 'fresh_1', key4);
ok('a brand new anonymous session requires signing up before anything else',
   await page4.locator('.panel[aria-label="Create your account"]').isVisible());
await ctx4.close();

await ctx2.close();
await ctx3.close();
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
