// A researched answer that arrives as five cards.
//
// raffy, 2026-09-02: "sometimes it gives lots of cards recommendation right.
// like hotels suggestion. can they all be group into one expandable
// collapsible group?"
//
// The first attempt folded everything past the second card away, and only for
// sets of four or more — so his set of three ideas produced no control at all.
// raffy, 2026-09-02: "it didn't present the cards in group that can be
// collapsed or expanded... so user dont have to scroll all . taking much
// space." The complaint is HEIGHT, not count, so the cards collapse
// individually now: the first stays open because it is the recommendation, and
// the rest are one scannable line each.
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

// --- five ---------------------------------------------------------------------
{
  const { ctx, page, errs } = await open(FIVE, 'sesn_F');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  // raffy, 2026-09-02: "i want it all in one card , but inside that card, they
  // are their own card." A column of separate floating cards reads as five
  // unrelated things that happen to be adjacent.
  ok('the whole set is one card', await page.locator('.optset').count() === 1);
  ok('every option is inside it', await page.locator('.optset .opt').count() === 5);
  const shadows = await page.locator('.optset .opt').evaluateAll(
    (els) => els.map((e) => getComputedStyle(e).boxShadow));
  ok('and none of them floats on its own', shadows.every((b) => b === 'none'), shadows[0]);
  ok('every option is on the page', await page.locator('.opt').count() === 5);
  ok('the recommendation is open', await page.locator('.opt:not(.row)').count() === 1);
  ok('and the rest are one line each', await page.locator('.opt.row').count() === 4);
  ok('a collapsed one still says what it is and what it costs',
     /TMS/.test(await page.locator('.opt.row').first().innerText())
     && /RM340/.test(await page.locator('.opt.row').first().innerText()),
     (await page.locator('.opt.row').first().innerText()).replace(/\n/g, ' | '));

  // The point of all this: what the agent said next is reachable without a
  // scroll through everything it found.
  const said = await page.locator('.msg.assistant', { hasText: 'I would take Furama' }).boundingBox();
  ok('what the agent said next is within a screen', said.y < 844, Math.round(said.y) + 'px down');

  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/fold-shut.png' });
  await page.locator('.opt.row').first().click();
  await page.waitForTimeout(300);
  ok('tapping one opens it in place', await page.locator('.opt:not(.row)').count() === 2);
  ok('with the reason it suits them', /Why TMS/.test(await page.locator('.block').innerText()));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/fold-open.png' });

  await page.locator('.rshut').first().click();
  await page.waitForTimeout(300);
  ok('and closes again', await page.locator('.opt.row').count() === 4);
  await ctx.close();
}

// --- three: the set he actually got ------------------------------------------
//
// The old threshold was "more than three", so this produced no control at all.
{
  const { ctx, page, errs } = await open(THREE, 'sesn_T');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a set of three collapses too', await page.locator('.opt.row').count() === 2,
     (await page.locator('.opt.row').count()) + ' rows');
  ok('with the first still open', await page.locator('.opt:not(.row)').count() === 1);
  await ctx.close();
}

// --- one: nothing to collapse ------------------------------------------------
{
  const ONE = { ...FIVE, items: FIVE.items.slice(0, 1) };
  const { ctx, page } = await open(ONE, 'sesn_O');
  ok('a single option is just shown', await page.locator('.opt.row').count() === 0);
  await ctx.close();
}

// --- ticking several: left expanded ------------------------------------------
//
// Comparing five hotels through a sequence of taps is worse than scrolling.
{
  const { ctx, page } = await open({ ...FIVE, pick: 'many' }, 'sesn_M');
  ok('a multi-pick set stays open', await page.locator('.opt.row').count() === 0);
  ok('so every one can be ticked', await page.locator('.pick.tick').count() === 5);
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
