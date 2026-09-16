// The real landing page: its own screen, a working ask box, and the handoff
// into planning — against a mocked backend.
//
//   BASE=http://localhost:3241 node setup/test-landing.mjs
//
// raffy, 2026-09-16, correcting the first cut of this feature: "no place it
// wrong. u placed it inside the chat session. i actually want it on the
// landing page." So this checks it renders BEFORE any app chrome, not after
// skipping onboarding.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let sent = null;
let hookCalls = 0;

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_LAND' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
await ctx.route('**/api/hook', (r) => {
  hookCalls++;
  const body = JSON.parse(r.request().postData());
  ok('the question reaches the server', body.question.includes('beach destination'), body.question);
  ok('the session id rides along', body.session === 'sesn_LAND', body.session);
  r.fulfill({ json: { answer: 'Da Nang and Nha Trang both work well in September — warm sea, fewer crowds, and My Khe beach is a short taxi from either airport.' } });
});
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });

// It's the very first thing shown — no header, no burger, no docked composer.
await page.locator('.land').waitFor({ state: 'visible' });
ok('the landing screen shows immediately, with no app chrome',
   await page.locator('.bar').count() === 0 && await page.locator('.composer').count() === 0);
ok('no "free question" framing anywhere on it',
   !(await page.locator('.land').innerText()).toLowerCase().includes('free question'));

// A chip both fills and fires the question.
await page.locator('.chip', { hasText: 'Beach' }).click();
await page.locator('.ans').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to the hook endpoint', hookCalls === 1, String(hookCalls));
ok('the answer is shown', (await page.locator('.ansbody').innerText()).includes('Da Nang and Nha Trang'));
ok('the CTA reads "Plan a trip", not a generic continue', await page.locator('.go.plan').innerText() === 'Plan a trip');

// Clicking it hands the same question to the real send() and leaves landing.
await page.locator('.go.plan').click();
await page.waitForTimeout(400);
ok('planning sends the original question as the real first message',
   sent && sent.text.includes('beach destination'), JSON.stringify(sent));
ok('the landing screen is gone, the real app is showing',
   await page.locator('.land').count() === 0 && await page.locator('.bar').count() === 1);

await page.screenshot({ path: 'shots/landing.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
