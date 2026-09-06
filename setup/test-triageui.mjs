// The 2026-09-06 chat-flow work, in a real browser:
//   - a card set answered yes / maybe / no in one pass
//   - the build stages ticking off a half-written itinerary
//
//   BASE=http://localhost:3411 node setup/test-triageui.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3411';
const SHOT = process.env.SHOT || 'shots';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const SPOTS = ['Cooking class', 'Night market', 'Sticky waterfall', 'Elephant sanctuary'];

const block = {
  role: 'block', id: 'blk1', kind: 'spots',
  title: 'Four things worth doing',
  intro: 'Say yes, maybe or no to each — all in one go.',
  items: [], facts: [],
  spots: SPOTS.map((n, i) => ({
    name: n,
    buzz: 'What people are actually posting about ' + n.toLowerCase() + '.',
    meta: (i + 1) * 10 + ' min from your hotel',
    rating: '4.' + (5 + (i % 4)) + ' on Google, 1,2' + i + '0 reviews',
    tags: ['Half a day', 'RM' + (60 + i * 20)],
  })),
  choose: false, pick: 'many', proposal: null,
};

// The exact shape raffy's Kuching session produced on 2026-09-06: kind=options,
// NINE cards, pick=many, and choose FALSE. Every card rendered with a "Tell me
// more" button and nothing to answer with.
const OPTIONS_MANY = {
  role: 'block', id: 'blk2', kind: 'options',
  title: 'Culture, history & food — Kuching in 2 days',
  intro: '', spots: [], facts: [],
  items: SPOTS.map((n, i) => ({
    name: n, why: 'Why ' + n + ' suits you.',
    price: 'about RM' + (30 + i * 15), rating: '4.' + (2 + i) + ' on Google, 1,0' + i + '2 reviews',
    meta: 'Old town', tags: ['2+ hrs'],
  })),
  choose: false, pick: 'many', proposal: null,
};

// A trip caught mid-build: shape and days exist, nothing else does yet.
const HALF = {
  trip: { title: 'Chiang Mai', sub: 'four nights' },
  days: [{ dow: 'Thu', dom: '10', stay: 0, title: 'Arrive', sub: 'Old City', items: [] }],
  stays: [], photos: {},
};

const browser = await chromium.launch();

async function page({ transcript, itinerary, building, progress }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const sent = [];
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/send', (r) => {
    sent.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ json: { ok: true } });
  });
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript, plan: {}, agentEdits: [], memoryOps: [], steps: [],
    itinerary: itinerary || null, building: !!building, progress: progress || null,
  } }));
  const p = await ctx.newPage();
  await p.goto(B + '/?s=sesn_X', { waitUntil: 'networkidle' });
  return { p, ctx, sent };
}

// --- 1. three-way triage ---------------------------------------------------
console.log('\nYes / maybe / no on a card set');
{
  const { p, ctx, sent } = await page({ transcript: [block] });
  await p.waitForSelector('text=Four things worth doing', { timeout: 8000 });

  const tri = p.locator('button.tri');
  ok('every card gets three buttons', await tri.count() === SPOTS.length * 3,
    await tri.count() + ' buttons for ' + SPOTS.length + ' cards');

  ok('the send bar starts disabled', await p.locator('button.send').isDisabled());

  await p.locator('button[aria-label="Yes Cooking class"]').click();
  await p.locator('button[aria-label="Yes Night market"]').click();
  await p.locator('button[aria-label="Maybe Sticky waterfall"]').click();
  await p.locator('button[aria-label="No Elephant sanctuary"]').click();

  ok('the bar counts every answer, not just the yeses',
    (await p.locator('.confirm .count').innerText()).includes('4 of 4'),
    await p.locator('.confirm .count').innerText());

  // The chat scrolls inside its own element, so a full-page shot still shows
  // the bottom. Look at the top card, where a Yes is.
  await p.locator('.scroll').evaluate((el) => { el.scrollTop = 0; });
  await p.waitForTimeout(200);
  await p.screenshot({ path: SHOT + '/triage.png' });

  await p.locator('button.send').click();
  await p.waitForTimeout(600);
  const msg = (sent[0] || {}).text || '';
  ok('one message carries all three verdicts',
    msg === 'Yes to Cooking class and Night market. Maybe Sticky waterfall. Not Elephant sanctuary.', msg);
  ok('exactly one message was sent for four answers', sent.length === 1, String(sent.length));
  await ctx.close();
}

// --- 2. tapping the same verdict clears it ---------------------------------
{
  const { p, ctx, sent } = await page({ transcript: [block] });
  await p.waitForSelector('button.tri', { timeout: 8000 });
  await p.locator('button[aria-label="Yes Cooking class"]').click();
  await p.locator('button[aria-label="Yes Cooking class"]').click();
  ok('a mis-tap is one tap back', await p.locator('button.send').isDisabled());
  await p.locator('button[aria-label="No Cooking class"]').click();
  await p.locator('button.send').click();
  await p.waitForTimeout(500);
  ok('a no can be the whole message', ((sent[0] || {}).text || '') === 'Not Cooking class.',
    (sent[0] || {}).text);
  await ctx.close();
}

// --- 3. build stages -------------------------------------------------------
console.log('\nOptions asking for many answers, with choose unset');
{
  const { p, ctx, sent } = await page({ transcript: [OPTIONS_MANY] });
  await p.waitForSelector('text=Culture, history', { timeout: 8000 });
  ok('every card can still be answered', await p.locator('button.tri').count() === SPOTS.length * 3,
    await p.locator('button.tri').count() + ' buttons');
  await p.locator('button[aria-label="Yes Cooking class"]').click();
  await p.locator('button[aria-label="No Elephant sanctuary"]').click();
  await p.locator('button.send').click();
  await p.waitForTimeout(500);
  ok('and the answer still goes back as one message',
    ((sent[0] || {}).text || '') === 'Yes to Cooking class. Not Elephant sanctuary.',
    (sent[0] || {}).text);
  await ctx.close();
}

console.log('\nBuild progress');
{
  const { p, ctx } = await page({
    transcript: [{ role: 'assistant', text: 'Building it now.', id: 'a1' }],
    itinerary: HALF, building: true, progress: { step: 4, steps: 14 },
  });
  await p.waitForSelector('.prog', { timeout: 8000 });
  const text = await p.locator('.prog').first().innerText();
  for (const label of ['The shape of your trip', 'Your days', 'Where you sleep',
    'What you do each day', 'Photographs', 'The map']) {
    ok('names the stage "' + label + '"', text.includes(label));
  }
  ok('counts what has landed', (await p.locator('.prog .pcount').first().innerText()).includes('2 of 6'),
    await p.locator('.prog .pcount').first().innerText());
  ok('ticks exactly the two that exist',
    await p.locator('.buildwrap .prog li.ok').count() === 2,
    String(await p.locator('.buildwrap .prog li.ok').count()));
  ok('marks the next one as running',
    await p.locator('.buildwrap .prog li.now').count() === 1);
  ok('offers a way into the half-written trip',
    await p.locator('.peek').isVisible());
  // With days in hand the trip itself is on screen, so the stages become a
  // compact strip above it and drop the reassurance line — there is nothing
  // to reassure about once you can see your trip.
  ok('the stages go compact once the trip is drawable',
    await p.locator('.prog.compact').count() === 1);
  ok('the trip is on screen while it is still being written',
    await p.locator('iframe[title="Itinerary preview"]').count() === 1);
  await p.screenshot({ path: SHOT + '/building.png' });
  await ctx.close();
}

// --- 4. nothing built yet --------------------------------------------------
{
  const { p, ctx } = await page({
    transcript: [{ role: 'assistant', text: 'Building it now.', id: 'a1' }],
    itinerary: null, building: true, progress: { step: 0, steps: 14 },
  });
  await p.waitForSelector('.prog', { timeout: 8000 });
  ok('an empty build ticks nothing and does not crash',
    (await p.locator('.prog .pcount').first().innerText()).includes('0 of 6'));
  // The one that matters on a phone: the stages are IN the chat, on screen,
  // not only in the trip pane the phone layout hides.
  ok('the stages are visible in the chat at 390px',
    await p.locator('.buildwrap .prog').isVisible());
  ok('and it says the build survives them leaving',
    (await p.locator('.prog').first().innerText()).toLowerCase().includes('keeps going if you close this'));
  await p.screenshot({ path: SHOT + '/building-empty.png' });
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
