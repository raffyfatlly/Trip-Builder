// The real landing page: public/welcome/index.html's ask box, and the
// handoff into the app — against a mocked backend.
//
//   BASE=http://localhost:3241 node setup/test-welcome.mjs
//
// raffy, 2026-09-16, after two earlier attempts landed this in the wrong
// place entirely: "i actually want it on the landing page. here." — a
// screenshot of THIS page. Then, seeing it still skip to an existing
// session: "u messed my chat agent? ... I told u I want the whole thing
// happening at the landing page." This checks the real static page, not a
// React stand-in for it, and that / is untouched for anyone who is not
// coming from here.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let hookCalls = 0;
let sent = null;

await ctx.route('**/api/hook', (r) => {
  hookCalls++;
  const body = JSON.parse(r.request().postData());
  ok('the question reaches the server', body.question.includes('beach destination'), body.question);
  ok('a stable per-browser id rides along, not a real session', /^w_/.test(body.session || ''), body.session);
  r.fulfill({ json: { answer: 'Da Nang and Nha Trang both work well in September.\n\n- Flights: KUL to DAD direct, about RM450-650 return\n- Stay: Furama or Vinpearl both work well for a relaxed week' } });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B + '/welcome', { waitUntil: 'networkidle' });

// A chip both fills and fires the question.
await page.locator('.cat', { hasText: 'Beach' }).click();
await page.locator('#askanswer').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to the hook endpoint', hookCalls === 1, String(hookCalls));
ok('the answer is shown', (await page.locator('#askanswerbody').innerText()).includes('Da Nang and Nha Trang'));
ok('the box loses its pill shape once it has answered',
   await page.locator('#askform').evaluate((el) => el.classList.contains('answered')));

// "Plan a trip" seeds localStorage and leaves the marketing page entirely.
await Promise.all([
  page.waitForURL('**/'),
  page.locator('#askplanbtn').click(),
]);

// The real app: mock its backend and reload so the seed effect can run.
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_WELCOME' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });
await page.goto(B + '/', { waitUntil: 'networkidle' });
await page.locator('.bar').waitFor({ state: 'visible', timeout: 5000 });
await page.waitForTimeout(300);

ok('the seeded question became the real first message',
   sent && sent.text.includes('beach destination'), JSON.stringify(sent));
ok('the app looks like the app — header and composer, no marketing chrome',
   await page.locator('.bar').count() === 1 && await page.locator('.composer').count() === 1);

// A second, ordinary visit to / with nothing seeded must be untouched —
// this is the regression the "messed my chat agent" report was about.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_PLAIN' } }));
await ctx2.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx2.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx2.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
let sent2 = null;
await ctx2.route('**/api/send', (r) => { sent2 = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });
const page2 = await ctx2.newPage();
await page2.goto(B, { waitUntil: 'networkidle' });
await page2.waitForTimeout(1200);
ok('a plain visit to / with nothing seeded starts onboarding as before, not the free-question box',
   await page2.locator('.ob').count() === 1 && await page2.locator('.hook, .land').count() === 0);
ok('and sends nothing on its own', sent2 === null, JSON.stringify(sent2));

await page.screenshot({ path: 'shots/welcome-answered.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
