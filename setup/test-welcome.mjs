// The real landing page: public/welcome/index.html's ask box, and that
// "Plan a trip" is a plain handoff — against a mocked backend.
//
//   BASE=http://localhost:3241 node setup/test-welcome.mjs
//
// raffy, 2026-09-16, after two earlier attempts landed this in the wrong
// place entirely: "i actually want it on the landing page. here." — a
// screenshot of THIS page. Then: "trigger sign up/signin button like usual
// for unregistered user /visitor. like before. and for the question no
// need to keep cause it might affect going forward." So "Plan a trip" is
// checked here as a PLAIN link to / — no seed, no auto-send — leaving the
// existing mustSignIn gate to do exactly what it always did.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let hookCalls = 0;

await ctx.route('**/api/hook', (r) => {
  hookCalls++;
  const body = JSON.parse(r.request().postData());
  ok('the question reaches the server', body.question.includes('street food'), body.question);
  ok('a stable per-browser id rides along, not a real session', /^w_/.test(body.session || ''), body.session);
  ok('the browser timezone rides along too, same as the chat agent gets',
     !!(body.client && body.client.tz), JSON.stringify(body.client));
  r.fulfill({ json: { answer: 'Da Nang and Nha Trang both work well in September.\n\n- Flights: KUL to DAD direct, about RM450-650 return\n- Stay: Furama or Vinpearl both work well for a relaxed week' } });
});

// A failed /api/hook must never silently punt them into /, where an old
// session — real for anyone who has used this before — would show up with
// no explanation at all. raffy, 2026-09-16: "it didn't give answer like
// before. it bring directly to chat session, which contains some of my
// past question." Checked in its own context so the failing route here
// never leaks into the success-path checks below.
const errCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await errCtx.route('**/api/hook', (r) => r.fulfill({ status: 500, json: { error: 'boom' } }));
const errPage = await errCtx.newPage();
await errPage.goto(B + '/welcome', { waitUntil: 'networkidle' });
await errPage.locator('.cat', { hasText: 'Food' }).click();
await errPage.locator('#askerr').waitFor({ state: 'visible', timeout: 5000 });
ok('a failed lookup shows an inline error, not a silent redirect',
   (await errPage.locator('#askerr').innerText()).length > 0);
ok('and it stays on the landing page rather than jumping to /',
   errPage.url().includes('/welcome'));
await errCtx.close();

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B + '/welcome', { waitUntil: 'networkidle' });

// The section introduces itself, same as every other one on the page.
ok('the ask box has its own header', (await page.locator('.askhead').innerText()).length > 0);

// A chip both fills and fires the question.
await page.locator('.cat', { hasText: 'Food' }).click();
await page.locator('#askanswer').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to the hook endpoint', hookCalls === 1, String(hookCalls));
ok('the answer is shown', (await page.locator('#askanswerbody').innerText()).includes('Da Nang and Nha Trang'));
ok('the box loses its pill shape once it has answered',
   await page.locator('#askform').evaluate((el) => el.classList.contains('answered')));
ok('there is no "ask something else" option', await page.locator('#askagain').count() === 0);

// "Plan a trip" is a plain link to / now — no seed, no state carried.
await Promise.all([
  page.waitForURL('**/'),
  page.locator('#askplanbtn').click(),
]);
const seedLeft = await page.evaluate(() => {
  try { return localStorage.getItem('itin.seed'); } catch (e) { return null; }
});
ok('the question is not carried into localStorage', seedLeft === null, String(seedLeft));

// The real app, on an ordinary fresh visit with nothing seeded: this is the
// exact regression "messed my chat agent" was about, still checked here.
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_WELCOME' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
let sent = null;
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });
await page.goto(B + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

ok('a plain landing on / with accounts off starts onboarding as before',
   await page.locator('.ob').count() === 1);
ok('and sends nothing on its own', sent === null, JSON.stringify(sent));

await page.screenshot({ path: 'shots/welcome-answered.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
