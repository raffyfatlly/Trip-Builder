// Topping up: an amount they type, not a card they pick.
//
//   BASE=http://localhost:3241 node setup/test-topup.mjs
//
// raffy, 2026-09-08: "the topup function is rm 10 minimum. then user can put
// any amount after that."

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
let posted = null;

// Somebody who has bought before and is now short — the only person the top-up
// is offered to.
const credits = { left: 9, granted: 115, used: 106, buildCost: 25, paid: true, signedIn: true };

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_TU' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'a@b.com' } } }));
await ctx.route('**/api/pay', (r) => {
  if (r.request().method() === 'POST') {
    posted = JSON.parse(r.request().postData());
    return r.fulfill({ json: { url: 'https://checkout.stripe.com/x' } });
  }
  return r.fulfill({ json: { ready: true, topup: { min: 10, max: 2000, perCredit: 0.28 }, packs: [
    { id: 'topup', name: 'Top up', myr: 10, credits: 35 },
    { id: 'starter', name: 'Plan a trip', myr: 28, credits: 100 },
    { id: 'plus', name: 'Plan a few', myr: 68, credits: 242 },
  ] } });
});
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }, { role: 'assistant', text: 'Hello.', id: 'a1' }],
  credits, plan: { destination: 'Penang' }, party: null,
  itinerary: null, agentEdits: [], memoryOps: [], building: false, thinking: false, turns: 2 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.locator('.buildnow').click().catch(() => {});
await page.waitForTimeout(600);

const box = page.locator('.topup');
ok('a returning customer gets an amount to type', await box.count() === 1);
ok('and it is NOT a fixed RM10 card any more',
   (await page.locator('.pack .pname').allInnerTexts()).every((x) => !/top up/i.test(x)),
   (await page.locator('.pack .pname').allInnerTexts()).join(', '));
ok('it opens at the minimum', await box.locator('input').inputValue() === '10');
ok('and says what that buys', (await box.locator('.tbtn').innerText()).includes('35 credits'),
   await box.locator('.tbtn').innerText());

await box.locator('input').fill('50');
await page.waitForTimeout(200);
ok('type a bigger number and the credits follow',
   (await box.locator('.tbtn').innerText()).includes('178 credits'),
   await box.locator('.tbtn').innerText());

await box.locator('input').fill('7');
await page.waitForTimeout(200);
ok('below the minimum it will not let them pay', await box.locator('.tbtn').isDisabled());
ok('and says why rather than just greying out',
   (await box.locator('.tbtn').innerText()).includes('RM10'), await box.locator('.tbtn').innerText());

await box.locator('input').fill('37');
await page.waitForTimeout(200);
// Shot before the tap: pressing it leaves for Stripe, and a screenshot of a
// blocked checkout page tells nobody anything.
await page.screenshot({ path: 'shots/topup.png' });
await box.locator('.tbtn').click();
await page.waitForTimeout(500);
ok('the amount is what gets sent', posted && posted.pack === 'topup' && posted.myr === 37,
   JSON.stringify(posted));
ok('and the credit count is NOT — the server prices it', posted && posted.credits === undefined,
   JSON.stringify(posted));

ok('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
