// How the conversation reads: one voice on the page, one in a bubble, the
// agent's working shown underneath, and an input you can write a paragraph in.
//
//   BASE=http://localhost:3261 node setup/test-chatshape.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3261';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const TRANSCRIPT = [
  { role: 'user', text: 'da nang with the kids, 10-14 sept', id: 'u1' },
  {
    role: 'assistant', id: 'a1',
    text: 'Good dates — that is shoulder season, so the beach still works and prices drop after the school holidays.\n\n- **Furama** on Bac My An, RM420/night\n- TMS Hotel, RM310/night\n- Sala Danang, RM280/night\n\nI would take Furama: the only one with a pool shallow enough for a three year old.',
    actions: [
      { icon: 'search', text: 'Searched', detail: 'Da Nang beachfront hotel family pool price' },
      { icon: 'search', text: 'Searched', detail: 'halal restaurants near My Khe beach' },
      { icon: 'check', text: 'Settled destination, dates, who' },
    ],
  },
];

const browser = await chromium.launch();
// A narrow window is still a desktop — Enter should send there. Only real
// touch emulation gives the phone's (hover:none)/(pointer:coarse), which is
// what the composer keys off.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
const errs = [];
let sent = null;
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: TRANSCRIPT, itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// --- who is in a bubble --------------------------------------------------
const bg = (sel) => page.locator(sel).evaluate((n) => getComputedStyle(n).backgroundColor);
ok('the traveller keeps their bubble', (await bg('.msg.user')) !== 'rgba(0, 0, 0, 0)');
ok('the agent has none', (await bg('.msg.assistant')) === 'rgba(0, 0, 0, 0)');

const box = await page.locator('.msg.assistant').boundingBox();
const scroll = await page.locator('.scroll').boundingBox();
ok('and takes the width of the column', box.width > scroll.width * 0.9,
   Math.round(box.width) + ' of ' + Math.round(scroll.width));
const ubox = await page.locator('.msg.user').boundingBox();
ok('while the traveller stays narrow and right', ubox.width < scroll.width * 0.85
   && (ubox.x + ubox.width) > (scroll.x + scroll.width * 0.8));
ok('formatting still works inside it', await page.locator('.msg.assistant strong').count() >= 1);
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/chatshape.png' });

// --- what it did ---------------------------------------------------------
ok('the work is summarised under the reply', await page.locator('.msg.assistant .acts').count() === 1);
ok('and counts the searches', (await page.locator('.acts button').innerText()).includes('2 searches'));
ok('collapsed by default', await page.locator('.acts li').count() === 0);
await page.locator('.acts button').click();
await page.waitForTimeout(300);
ok('opening shows every step', await page.locator('.acts li').count() === 3);
ok('including what it actually searched for',
   (await page.locator('.acts').innerText()).includes('halal restaurants near My Khe beach'));
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/actions.png' });

// --- writing a long message ----------------------------------------------
const ta = page.locator('textarea');
const h = () => ta.evaluate((n) => n.getBoundingClientRect().height);
const oneLine = await h();
await ta.fill('A much longer message that will certainly need to wrap onto several lines in a phone-width composer, because it keeps going and going.');
await page.waitForTimeout(300);
const grown = await h();
ok('the box grows with what they write', grown > oneLine + 20, oneLine + 'px -> ' + grown + 'px');

await ta.fill('short again');
await page.waitForTimeout(300);
ok('and shrinks back', (await h()) < grown - 15);

// The point of the whole exercise: a second paragraph, on a phone.
await ta.fill('First paragraph.');
await ta.press('Enter');
await ta.press('Enter');
await ta.type('Second paragraph.');
await page.waitForTimeout(300);
ok('Enter makes a new line rather than sending', sent === null);
ok('so a paragraph is possible', (await ta.inputValue()).includes('First paragraph.\n')
   && (await ta.inputValue()).includes('Second paragraph.'));
ok('and it grew to fit', (await h()) > oneLine + 20);
await page.locator('.sendbtn').click();
await page.waitForTimeout(500);
ok('the button is what sends', !!sent && sent.text.includes('Second paragraph.'));
ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
await ctx.close();

// --- with a real keyboard, Enter still sends -----------------------------
{
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: false });
  let s2 = null;
  await c2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_D' } }));
  await c2.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await c2.route('**/api/send', (r) => { s2 = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  await c2.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: TRANSCRIPT, itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(B, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1400);
  await p2.locator('textarea').fill('send this');
  await p2.locator('textarea').press('Enter');
  await p2.waitForTimeout(500);
  ok('at a desk, Enter sends as always', !!s2 && s2.text === 'send this');

  await p2.locator('textarea').fill('line one');
  await p2.locator('textarea').press('Shift+Enter');
  await p2.locator('textarea').type('line two');
  await p2.waitForTimeout(250);
  ok('and shift+Enter breaks the line', (await p2.locator('textarea').inputValue()).includes('line one\nline two'));
  await c2.close();
}

// --- the composer once it wraps ------------------------------------------
{
  const c3 = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  await c3.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_C' } }));
  await c3.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await c3.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: TRANSCRIPT, itinerary: null, plan: { destination: 'Da Nang, Vietnam' },
    agentEdits: [], memoryOps: [], building: false, thinking: false, turns: 1 } }));
  const p3 = await c3.newPage();
  p3.on('pageerror', (e) => errs.push(e.message));
  await p3.goto(B, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1400);

  const ta3 = p3.locator('textarea');
  const send3 = p3.locator('.sendbtn');
  const midY = async (l) => { const b = await l.boundingBox(); return b.y + b.height / 2; };

  await ta3.fill('short');
  await p3.waitForTimeout(250);
  ok('one line keeps everything on one row', await p3.locator('.composer .row.tall').count() === 0);
  ok('and the send button sits beside the text',
     Math.abs((await midY(ta3)) - (await midY(send3))) < 14);

  await ta3.fill('A much longer message that will certainly wrap onto several lines in a composer this narrow, because it simply keeps going.');
  await p3.waitForTimeout(350);
  ok('once it wraps, the controls drop to their own row', await p3.locator('.composer .row.tall').count() === 1);
  ok('the text now sits above them', (await midY(ta3)) < (await midY(send3)) - 20);
  const tb = await ta3.boundingBox();
  const rb = await p3.locator('.composer .row').boundingBox();
  ok('and takes the full width', tb.width > rb.width * 0.85,
     Math.round(tb.width) + ' of ' + Math.round(rb.width));
  await p3.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/composer-tall.png' });

  await ta3.fill('short');
  await p3.waitForTimeout(300);
  ok('deleting it back collapses the row again', await p3.locator('.composer .row.tall').count() === 0);
  await c3.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
