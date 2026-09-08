// The two things raffy could see, seen the same way he saw them.
//
//   BASE=http://localhost:3241 node setup/test-asideui.mjs
//
// 1. "credit spent should appear under agent respond beside tool used etc.
//    structured same way same thickness font" — it was on its own line, in the
//    coral that Rich uses for a PRICE, because the class was called `cost` and
//    `.cost` is a price. Now it is in the actions row at the actions weight.
// 2. "I still have the original text accumulating at the bottom" — an
//    optimistic bubble the server's transcript never matched, once per message
//    sent, for the length of the conversation.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

// A shared trip, two people in it, and a turn that cost something.
const party = { owner: 'raffy.fatlly@gmail.com', guests: ['syahirah@x.com'], me: 'raffy.fatlly@gmail.com', shared: true };
const base = [
  { role: 'user', text: 'where should we stay', id: 'u1', who: 'raffy.fatlly@gmail.com' },
  { role: 'assistant', text: 'Two that would suit you both.', id: 'a1',
    actions: [{ icon: 'search', text: 'Searched for hotels' }] },
  { role: 'user', text: 'i like the second one', id: 'held:5', who: 'syahirah@x.com', aside: true },
];
let used = 10;
let extra = [];

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'raffy.fatlly@gmail.com' } } }));
await ctx.route('**/api/send', (r) => r.fulfill({ json: { ok: true, spoke: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [...base, ...extra], party,
  credits: { left: 88, granted: 100, used, plan: 'starter', buildCost: 25, paid: true, signedIn: 'raffy.fatlly@gmail.com' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 2 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// --- the aside is a message, in its place --------------------------------
ok('what she said to him is in the thread', await page.locator('.msg.aside').count() === 1);

// --- a second turn, which costs 2 credits --------------------------------
extra = [
  { role: 'user', text: 'book it then', id: 'u2', who: 'raffy.fatlly@gmail.com' },
  { role: 'assistant', text: 'Booked, and put on day two.', id: 'a2',
    actions: [{ icon: 'search', text: 'Checked live prices' }] },
];
used = 12;
// Three polls. The figure is withheld until the same balance has been read
// twice — a charge lands a moment after the reply it belongs to, and showing
// the first reading is how the meter came to say 0 for a 4-credit turn.
await page.waitForTimeout(8000);

// An aside is a message in the conversation, not a footer. Once the next turn
// lands it has to still be where it was said, with newer messages under it.
ok('and the conversation carries on underneath it',
   !(await page.locator('.msg').last().evaluate((n) => n.classList.contains('aside'))));

const row = page.locator('.acts').last();
ok('the credit figure is in the actions row', await row.locator('.cred').count() === 1);
const [act, cred] = await Promise.all([
  row.locator('button span').first().evaluate((n) => getComputedStyle(n)),
  row.locator('.cred').evaluate((n) => getComputedStyle(n)),
]).then((s) => s.map((x) => ({ size: x.fontSize, weight: x.fontWeight, colour: x.color })));
ok('same size as "1 search"', act.size === cred.size, act.size + ' vs ' + cred.size);
ok('same weight', act.weight === cred.weight, act.weight + ' vs ' + cred.weight);
ok('same colour — quiet, not coral', act.colour === cred.colour, act.colour + ' vs ' + cred.colour);
ok('and it says what it is', (await row.locator('.cred').innerText()).includes('2 credits'),
   await row.locator('.cred').innerText());
ok('on one line with the actions',
   await row.locator('.row').evaluate((n) => n.getBoundingClientRect().height < 30));

// --- sending does not leave a second copy behind -------------------------
await page.locator('textarea').fill('and dinner nearby');
await page.locator('.sendbtn').click();
await page.waitForTimeout(500);
const doubled = async (t) => await page.locator('.msg.user', { hasText: t }).count();
ok('the optimistic bubble appears at once', await doubled('and dinner nearby') === 1);

// The server catches up — and, as it does on a shared trip, does NOT echo the
// text back verbatim: the @ is stripped and (in older sessions) the name was
// prefixed. Either way the bubble has to go.
extra = [...extra, { role: 'user', text: 'raffy.fatlly: and dinner nearby', id: 'u3', who: 'raffy.fatlly@gmail.com' }];
await page.waitForTimeout(5200);
ok('and there is only ever one of it', await doubled('and dinner nearby') === 1,
   'copies: ' + await doubled('and dinner nearby'));

await page.screenshot({ path: 'shots/turn-cost.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
