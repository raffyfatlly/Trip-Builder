// Typing the first line must not glitch at the wrap point.
//
// raffy, 2026-09-01: "as i was writing the first line, at the end, some words
// and letters go missing, and glitch. only after finishing that last few lines
// and moving to second line it will stabilise again."
//
// Two causes, both here:
//   1. the height was applied in a useEffect, i.e. AFTER the browser painted
//      the new character — one frame at the old height, where the textarea
//      scrolls itself and the end of the line disappears;
//   2. the tall/short switch used one threshold, and switching to tall changes
//      the row from flex to grid AND changes the textarea's padding, which
//      changes the measurement that decided to switch. A word sitting on the
//      boundary flipped the whole composer on every keystroke.
//
//   BASE=http://localhost:3272 node setup/test-composer-wrap.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

const B = process.env.BASE || 'http://localhost:3272';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_X'));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const ta = page.locator('textarea');
await ta.click();

// One character at a time, straight through the wrap point.
const TEXT = 'we want to go to phu quoc in october with two kids and my wife';
const seen = [];
for (const ch of TEXT) {
  await ta.type(ch, { delay: 0 });
  seen.push(await page.evaluate(() => {
    const t = document.querySelector('textarea');
    const row = document.querySelector('.row');
    return {
      tall: row.classList.contains('tall'),
      // Anything above 0 means the box is scrolled and text is hidden.
      scrollTop: t.scrollTop,
      // Content taller than the box is the "letters go missing" state.
      clipped: t.scrollHeight - t.clientHeight > 1,
      len: t.value.length,
    };
  }));
}

const flips = seen.filter((s, i) => i > 0 && s.tall !== seen[i - 1].tall).length;
ok('the composer switches to tall once, not back and forth', flips <= 1, 'flips=' + flips);
ok('the box is never scrolled while typing', seen.every((s) => s.scrollTop === 0),
   'first at char ' + (seen.findIndex((s) => s.scrollTop !== 0) + 1));
ok('and never clips what was typed', seen.every((s) => !s.clipped),
   'first at char ' + (seen.findIndex((s) => s.clipped) + 1));
ok('every keystroke landed', seen[seen.length - 1].len === TEXT.length,
   seen[seen.length - 1].len + ' of ' + TEXT.length);
ok('it did end up tall', seen[seen.length - 1].tall);

// And back down again, without flapping on the way.
const back = [];
for (let i = 0; i < TEXT.length; i++) {
  await page.keyboard.press('Backspace');
  back.push(await page.evaluate(() => document.querySelector('.row').classList.contains('tall')));
}
const backFlips = back.filter((t, i) => i > 0 && t !== back[i - 1]).length;
ok('and shrinks back once on delete', backFlips <= 1, 'flips=' + backFlips);
ok('no page errors', errs.length === 0, errs.join(' / '));

await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/composer-wrap.png' });

// --- coming back from the trip ----------------------------------------------
//
// raffy, 2026-09-01: "sometimes when im back from app to chat, the chat input
// fill become like in photo" — the placeholder sliced in half. On a phone the
// trip pane hides the chat outright, so any grow() that fired while it was open
// measured a hidden box, read scrollHeight 0, and wrote height:0px. Coming back
// re-showed a box that had already been told to be nothing.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_H' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: REAL, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_H'));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const box = () => page.locator('.composer textarea').evaluate((el) => el.getBoundingClientRect().height);
  const before = await box();
  console.log('');
  ok('the composer starts at a sane height', before > 24, Math.round(before) + 'px');

  // Open the trip, which hides the chat on a phone, then come back.
  await page.locator('header .itbtn').click();
  await page.waitForTimeout(900);
  await page.locator('.panehead .back').click();
  await page.waitForTimeout(700);

  const after = await box();
  ok('and is still that height on the way back', Math.abs(after - before) < 4,
     Math.round(before) + 'px then ' + Math.round(after) + 'px');
  ok('the placeholder is not sliced', after > 24, Math.round(after) + 'px');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
