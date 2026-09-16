// The landing-page free question, end to end against a mocked backend.
//
//   BASE=http://localhost:3241 node setup/test-hookbox.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let sent = null;
let hookCalls = 0;

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_HOOK' } }));
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
  ok('the question reaches the server', body.question === 'Is Da Nang worth it in September with two kids?', body.question);
  ok('the session id rides along', body.session === 'sesn_HOOK', body.session);
  r.fulfill({ json: { answer: 'Yes — September is shoulder season: fewer crowds, warm sea, occasional short showers. Furama and Vinpearl both work well with kids for the pool.' } });
});
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });

// Past onboarding, into the empty-chat landing state where HookBox lives.
await page.locator('.skipall').click();
await page.locator('.hook').waitFor({ state: 'visible' });
ok('the free-question box shows on the empty landing state', true);

// The example chip both fills and fires the question in one tap — the whole
// point being it does something real now, not just prefill the composer.
await page.locator('.hookeg', { hasText: 'Is Da Nang worth it in September with two kids?' }).click();
await page.locator('.hookans').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to the hook endpoint', hookCalls === 1, String(hookCalls));
ok('the answer is shown', (await page.locator('.hookbody').innerText()).includes('September is shoulder season'));

// Continue hands the same question to the real send(), same as typing it.
await page.locator('.hookcta').click();
await page.waitForTimeout(400);
ok('continuing sends the original question as the real first message',
   sent && sent.text === 'Is Da Nang worth it in September with two kids?', JSON.stringify(sent));
ok('the hook box is gone once a real message exists',
   await page.locator('.hook').count() === 0);

await page.screenshot({ path: 'shots/hookbox.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
