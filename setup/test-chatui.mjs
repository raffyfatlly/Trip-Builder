// Reading the chat: scrolling back without being yanked to the bottom, and
// messages that are not a wall of even grey.
//
//   BASE=http://localhost:3241 node setup/test-chatui.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const long = Array.from({ length: 25 }, (_, i) => ([
  { role: 'user', text: 'question number ' + i, id: 'u' + i },
  { role: 'assistant', text: 'A reply of some length so the thread is genuinely scrollable. Number ' + i + '.', id: 'a' + i },
])).flat();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
let sent = null;
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [...long, {
    role: 'assistant',
    text: 'I would take **Furama Resort** — it is the only one with a pool that suits a three year old, and it is RM90 a night cheaper.\n\n- Beach on the doorstep, RM420/night\n- Ten minutes from the airport\n- Halal breakfast included\n\nTheir site is https://www.furamavietnam.com/ if you want a look.',
    id: 'rich',
  }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 3 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// --- scrolling back ------------------------------------------------------
const el = page.locator('.scroll');
const at = () => el.evaluate((n) => Math.round(n.scrollTop));
ok('it opens at the newest message',
   await el.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 60));

// The list scrolls smoothly, so wait for it to actually settle before taking
// a reading — measuring mid-animation makes a working app look broken, which
// is exactly what it did the first time.
const settle = async () => {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const now = await at();
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(120);
  }
  return last;
};

await el.evaluate((n) => { n.scrollTop = 200; });
const parked = await settle();
// Two full polls. Before this fix, each one yanked the view back down.
await page.waitForTimeout(5000);
ok('scrolling up stays put across several polls', Math.abs((await at()) - parked) < 40,
   'moved ' + Math.abs((await at()) - parked) + 'px');

// Back at the bottom, it should follow again.
await el.evaluate((n) => { n.scrollTop = n.scrollHeight; });
await page.waitForTimeout(2600);
ok('at the bottom it still follows along',
   await el.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 60));

// Sending always brings you back down, wherever you were reading.
await el.evaluate((n) => { n.scrollTop = 100; });
await page.locator('textarea').fill('one more thing');
await page.locator('.sendbtn').click();
await page.waitForTimeout(900);
ok('sending returns you to the conversation',
   await el.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 120));

// --- the message itself --------------------------------------------------
// Not .last(): the typing bubble is also .msg.assistant, and it is on screen
// for a moment after sending.
const rich = page.locator('.msg.assistant:not(.typing)').last();
ok('bold is bold', await rich.locator('strong:has-text("Furama Resort")').count() === 1);
ok('a list is a list', await rich.locator('li').count() === 3);
ok('a price stands out', await rich.locator('.cost').count() >= 1);
const costs = (await rich.locator('.cost').allInnerTexts()).map((t) => t.replace(/\s/g, ''));
ok('the price is the price, not the sentence', costs.includes('RM420') && costs.includes('RM90'),
   costs.join(' | '));
ok('a link is a link', await rich.locator('a[href="https://www.furamavietnam.com/"]').count() === 1);
ok('and it is tidied for reading',
   (await rich.locator('a').first().innerText()).trim() === 'furamavietnam.com');
ok('their own messages are left alone',
   await page.locator('.msg.user strong').count() === 0);
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/rich.png' });

ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
await ctx.close();

// --- the moment a build finishes -----------------------------------------
// It takes minutes, so it lands while they are reading something else. The
// way in has to be where they are looking, not only in the header.
{
  const fs = await import('fs');
  const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let phase = { itinerary: null, building: true };
  await c2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_B' } }));
  await c2.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await c2.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'build it', id: 'u1' }],
    itinerary: phase.itinerary, plan: {}, agentEdits: [], memoryOps: [],
    building: phase.building, thinking: false, turns: 2 } }));
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(B, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1400);

  ok('while building, no ready card', await p2.locator('.done').count() === 0);
  ok('it says it is working instead', await p2.locator('.working').count() === 1);

  phase = { itinerary: REAL, building: false };
  await p2.waitForTimeout(2600);
  ok('when it finishes, the way in is in the conversation', await p2.locator('.done').count() === 1);
  ok('and it names the trip', (await p2.locator('.done').innerText()).includes('Da Nang'));
  ok('and marks itself as new', await p2.locator('.done .new').count() === 1);
  await p2.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/ready.png' });

  await p2.locator('.done button').click();
  await p2.waitForTimeout(800);
  ok('the button opens the itinerary', await p2.locator('.pane.open').count() === 1);

  await p2.locator('.panehead .back').click();
  await p2.waitForTimeout(700);
  // raffy, 2026-09-01: "that message disappear after i click open. just let it
  // stay in the chat right." The same flag both showed the card and marked it
  // seen, so opening the trip deleted it. It is part of the conversation, not
  // a notification.
  ok('the way in stays in the conversation', await p2.locator('.done').count() === 1);
  ok('and it stops calling itself new', await p2.locator('.done .new').count() === 0);
  ok('but still opens the trip', await p2.locator('.done button').count() === 1);
  ok('leaving the header button behind', await p2.locator('header .itbtn').count() === 1);
  await c2.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
