// When the packs are allowed to appear, and when they are not.
//
//   BASE=http://localhost:3241 node setup/test-buildgate.mjs
//
// raffy, 2026-09-07, with a screenshot of the packs panel sitting in a chat
// where nothing had happened yet: "this part should only appear when new user
// ran out of their free credit." And, a minute later: "or when they want to
// click the build button."
//
// It used to key on the balance alone — and a free account is under the cost of
// a build from its first message, so the offer greeted every new user and never
// went away. An offer that is always on screen is furniture.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

// A free account, four credits, mid-conversation. A build costs 25, so the old
// rule showed the packs here — which is exactly the screenshot he sent.
let credits = { left: 4, granted: 4, used: 0, buildCost: 25, paid: false, signedIn: true };
let denied = false;
let sent = [];

const transcript = [
  { role: 'user', text: 'four days in penang', id: 'u1' },
  { role: 'assistant', text: 'Good. Who is going?', id: 'a1' },
];

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_BG' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'new@x.com' } } }));
await ctx.route('**/api/pay*', (r) => r.fulfill({ json: { ready: true, packs: [
  { id: 'starter', name: 'Plan a trip', credits: 100, myr: 28, blurb: 'One big trip.' },
  { id: 'plus', name: 'Plan a few', credits: 242, myr: 68, blurb: 'A few trips.' },
] } }));
await ctx.route('**/api/send', (r) => { sent.push(JSON.parse(r.request().postData()).text); r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript, credits, buildDenied: denied,
  // Enough of a plan that the checklist — and its build button — is on screen.
  plan: { destination: 'Penang', dates: '12-16 Oct', who: 'two adults' },
  itinerary: null, agentEdits: [], memoryOps: [], party: null,
  building: false, thinking: false, turns: 2 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const wall = page.locator('.wall.low');

// --- the state he screenshotted --------------------------------------------
ok('a new account with free credit left is not sold to', await wall.count() === 0,
   await wall.count() ? await wall.innerText() : '');
ok('and can still type', !(await page.locator('textarea').isDisabled()));

// --- but tapping build answers on the tap -----------------------------------
await page.locator('.buildnow').click();
await page.waitForTimeout(400);
ok('tapping build brings up the packs', await wall.count() === 1);
ok('it answers the tap rather than warning about it',
   (await wall.innerText()).includes('Building it needs a top-up'), await wall.innerText());
ok('it says what it needs and what they have',
   /25/.test(await wall.innerText()) && /\b4\b/.test(await wall.innerText()), await wall.innerText());
ok('and both packs are there to buy', await page.locator('.wall.low .pack').count() === 2,
   'found ' + await page.locator('.wall.low .pack').count());
ok('the tap did NOT spend a turn asking the server', sent.length === 0, JSON.stringify(sent));

await page.screenshot({ path: 'shots/pay-build-tap.png' });

// --- topping up puts it away ------------------------------------------------
credits = { left: 104, granted: 104, used: 0, buildCost: 25, paid: true, signedIn: true };
await page.waitForTimeout(2600);
ok('paying takes it away again', await wall.count() === 0,
   await wall.count() ? await wall.innerText() : '');

// --- a build the server refused ---------------------------------------------
credits = { left: 4, granted: 4, used: 2, buildCost: 25, paid: false, signedIn: true };
denied = true;
await page.waitForTimeout(2600);
ok('a build refused by the server shows them why', await wall.count() === 1);
ok('and leads with the top-up rather than the refusal',
   (await wall.innerText()).includes('Building it needs a top-up'), await wall.innerText());

// --- somebody who has paid before and is short gets it early -----------------
denied = false;
credits = { left: 9, granted: 104, used: 95, buildCost: 25, paid: true, signedIn: true };
await page.waitForTimeout(2600);
ok('a returning customer who is short is warned before they ask',
   (await wall.innerText()).includes('Not quite enough'), await wall.innerText());

ok('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
