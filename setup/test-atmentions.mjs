// Where a message went, what a turn cost, and where the toggle is pointing.
//
//   BASE=http://localhost:3241 node setup/test-atmentions.mjs
//
// raffy, 2026-09-07, three things in one message:
//   "i don't see the credits spent. do i need to start new chat?"
//   "the toggle should stay the last one it choose not back to person."
//   "in chat where there are other people, let it auto put @user or @agent in
//    the chat itself so its clear. but don't put it in the chat input."

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

const party = { owner: 'raffy.fatlly@gmail.com', guests: ['syahirahmohamadkasim@gmail.com'], me: 'raffy.fatlly@gmail.com', shared: true };
const base = [
  { role: 'user', text: 'where should we stay', id: 'u1', who: 'raffy.fatlly@gmail.com' },
  { role: 'assistant', text: 'Two that would suit you both.', id: 'a1',
    actions: [{ icon: 'search', text: 'Searched for hotels' }] },
  { role: 'user', text: 'i like the second one', id: 'held:5', who: 'syahirahmohamadkasim@gmail.com', aside: true },
];
let used = 10;
let extra = [];
let sent = null;

await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_AT' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: { email: 'raffy.fatlly@gmail.com' } } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [...base, ...extra], party,
  credits: { left: 88, granted: 100, used, plan: 'starter', buildCost: 25, paid: true, signedIn: 'raffy.fatlly@gmail.com' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 2 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// --- @ on the message, never in the composer ------------------------------
const mine = page.locator('.msg.user').first();
ok('a message to the assistant is marked @agent',
   (await mine.innerText()).includes('@agent'), await mine.innerText());
const hers = page.locator('.msg.user.aside').first();
ok('and one said to a person carries their name',
   (await hers.innerText()).includes('@raffy.fatlly'), await hers.innerText());
ok('the composer is left alone', (await page.locator('textarea').inputValue()) === '');

// --- the toggle stays where he put it ------------------------------------
await page.locator('.dest').click();
ok('tapping it aims at the assistant', (await page.locator('.dest').innerText()).includes('Assistant'));
await page.locator('textarea').fill('what about dinner');
await page.locator('.sendbtn').click();
await page.waitForTimeout(600);
ok('the message goes to the assistant', sent && sent.asked === true, JSON.stringify(sent && sent.asked));
ok('and the toggle is STILL on the assistant afterwards',
   (await page.locator('.dest').innerText()).includes('Assistant'),
   await page.locator('.dest').innerText());

// --- and it survives the tab reloading ------------------------------------
extra = [{ role: 'user', text: 'what about dinner', id: 'u2', who: 'raffy.fatlly@gmail.com' }];
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
ok('a reload does not point it back at the other person',
   (await page.locator('.dest').innerText()).includes('Assistant'),
   await page.locator('.dest').innerText());

// --- what the turn cost, still there after the reload ---------------------
// The reading the next turn is measured against is saved, so the first reply
// after a reload is priced instead of being blank — which is what he was
// actually looking at when he asked whether he needed a new chat.
extra = [...extra, { role: 'assistant', text: 'Two good ones nearby.', id: 'a2',
  actions: [{ icon: 'search', text: 'Searched' }] }];
used = 14;
await page.waitForTimeout(5200);
const cred = page.locator('.acts .cred').last();
ok('the first reply after a reload still shows its cost',
   await cred.count() === 1 && (await cred.innerText()).includes('4 credits'),
   await cred.count() ? await cred.innerText() : 'nothing shown');

await page.screenshot({ path: 'shots/at-mentions.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
