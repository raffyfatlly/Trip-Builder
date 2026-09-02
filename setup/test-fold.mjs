// A researched answer that arrives as five cards.
//
// raffy, 2026-09-02: "sometimes it gives lots of cards recommendation right.
// like hotels suggestion. can they all be group into one expandable
// collapsible group?"
//
// Five option cards is a screen and a half of scrolling before you reach the
// next thing the agent said. Not the whole set behind a title, though — that
// hides the recommendation, which is the part worth reading. The top two stay
// out and the rest fold away.
//
//   BASE=http://localhost:3274 node setup/test-fold.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { blockFrom } from '../lib/blocks.js';

const B = process.env.BASE || 'http://localhost:3274';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const hotel = (name, price) => ({ name, price, why: 'Why ' + name + ' suits them.' });
const FIVE = {
  kind: 'options', title: 'Five hotels in An Thuong', choose: true,
  intro: 'Cheapest first.',
  items: ['Furama', 'TMS', 'Sala', 'Grandvrio', 'Fusion Maia'].map((n, i) => hotel(n, 'RM' + (280 + i * 60) + '/night')),
};
const THREE = { ...FIVE, title: 'Three hotels in An Thuong', items: FIVE.items.slice(0, 3) };

const browser = await chromium.launch();
const open = async (block, session) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [
      { role: 'user', text: 'where should we stay', id: 'u1' },
      { ...blockFrom({ id: 'b1', name: 'present', input: block }) },
      { role: 'assistant', text: 'I would take Furama.', id: 'a1' },
    ],
    itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('itin.session.v1', s), session);
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  return { ctx, page, errs };
};

// --- five: folded ------------------------------------------------------------
{
  const { ctx, page, errs } = await open(FIVE, 'sesn_F');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  ok('the recommendation is still on screen', await page.locator('.opt').count() === 2,
     (await page.locator('.opt').count()) + ' cards');
  ok('and the rest are folded away', await page.locator('.fold').count() === 1);
  ok('the button says how many are under it',
     /show 3 more/i.test(await page.locator('.fold').innerText()),
     await page.locator('.fold').innerText());

  // The point of folding: what the agent said next is reachable without a
  // scroll through everything it found.
  const said = await page.locator('.msg.assistant', { hasText: 'I would take Furama' }).boundingBox();
  ok('what the agent said next is within a screen', said.y < 844, Math.round(said.y) + 'px down');

  await page.locator('.fold').click();
  await page.waitForTimeout(350);
  ok('opening it shows all five', await page.locator('.opt').count() === 5);
  ok('and it folds back up', /show fewer/i.test(await page.locator('.fold').innerText()));

  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/fold-open.png' });
  await page.locator('.fold').click();
  await page.waitForTimeout(350);
  ok('closing it puts them away again', await page.locator('.opt').count() === 2);
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/fold-shut.png' });
  await ctx.close();
}

// --- three: left alone -------------------------------------------------------
//
// Folding one card away is a control that costs more than it saves.
{
  const { ctx, page, errs } = await open(THREE, 'sesn_T');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a short set is not folded', await page.locator('.fold').count() === 0);
  ok('and shows every card', await page.locator('.opt').count() === 3);
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
