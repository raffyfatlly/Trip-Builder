// The credit figure under every reply, first one included.
//
//   BASE=http://localhost:3241 node setup/test-turncost.mjs
//
// raffy, 2026-09-08: "credit should appear at every agent response (at the very
// bottom). do it like how claude handles token count but we do for credit
// instead."
//
// Two things stopped it. A zero was hidden, on the reasoning that "0 credits"
// invites a question about fractions — which treats the figure as a charge when
// he is treating it as a meter. And the FIRST reply of a session had nothing to
// measure against, because the baseline was only taken when a reply was priced,
// so the opening turn of every conversation drew a blank.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

// A brand new conversation: nothing said, nothing spent.
let transcript = [];
let used = 0;

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_TC' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'new@x.com' } } }));
await ctx.route('**/api/send', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript,
  credits: { left: 10 - used, granted: 10, used, buildCost: 25, paid: false, signedIn: true },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [], party: null,
  building: false, thinking: false, turns: transcript.length } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// Skip the onboarding card if it is in the way — this test is about the meter.
const skip = page.locator('button', { hasText: /just start typing|skip/i }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(300); }

// --- the first turn of a brand new session --------------------------------
await page.locator('textarea').fill('four days in penang');
await page.locator('.sendbtn').click();
await page.waitForTimeout(500);

transcript = [
  { role: 'user', text: 'four days in penang', id: 'u1' },
  { role: 'assistant', text: 'Lovely. Who is going?', id: 'a1' },
];
used = 3;
await page.waitForTimeout(5200);

const creds = page.locator('.acts .cred');
ok('the FIRST reply of a session is priced', await creds.count() === 1,
   'found ' + await creds.count());
ok('and it is the real cost of that turn', (await creds.first().innerText()).includes('3 credits'),
   await creds.first().innerText());

// --- a turn that cost nothing still says so --------------------------------
transcript = [...transcript,
  { role: 'user', text: 'thanks', id: 'u2' },
  { role: 'assistant', text: 'Any time.', id: 'a2' }];
await page.waitForTimeout(5200);
ok('a free turn shows a zero rather than nothing', await creds.count() === 2,
   'found ' + await creds.count());
ok('and reads as zero', (await creds.last().innerText()).includes('0 credits'),
   await creds.last().innerText());

// --- a reply with no tool row still carries its figure ---------------------
ok('the figure does not need an actions row to hang off',
   await page.locator('.acts').last().locator('button').count() === 0
   && (await page.locator('.acts').last().innerText()).includes('credits'),
   await page.locator('.acts').last().innerText());

await page.screenshot({ path: 'shots/turn-cost-every.png' });

// --- and the ring, once they are running low -------------------------------
// raffy, 2026-09-08: "use the circular one like claude usage ring." Same
// component the drawer and the paywall draw, shrunk, with its number beside it.
used = 8;
await page.waitForTimeout(2600);
const fuel = page.locator('.fuel');
ok('running low brings up the ring', await fuel.locator('svg circle').count() === 1);
ok('and says what is left', (await fuel.innerText()).includes('2 credits left'),
   await fuel.innerText());
ok('it is still only a hint, not a banner',
   await fuel.evaluate((n) => n.getBoundingClientRect().height) < 40,
   String(await fuel.evaluate((n) => Math.round(n.getBoundingClientRect().height))));
await page.screenshot({ path: 'shots/fuel-ring-low.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
