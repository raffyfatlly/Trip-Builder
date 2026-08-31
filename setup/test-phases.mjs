// Research → propose → build, and the nudge to send bookings.
// Production build, stubbed API. No agent, no cost.
//
//   BASE=http://localhost:3218 node setup/test-phases.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { blockFrom, PROPOSE_TOOL, PRESENT_TOOL } from '../lib/blocks.js';

const B = process.env.BASE || 'http://localhost:3218';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the block shapes, without a browser ---------------------------------
ok('spots is an offered kind', PRESENT_TOOL.input_schema.properties.kind.enum.includes('spots'));
ok('a proposal needs the days laid out', PROPOSE_TOOL.input_schema.required.includes('days'));
const spotBlock = blockFrom({ id: 'e1', name: 'present', input: { kind: 'spots', title: 'Doing the rounds', spots: [{ name: 'Golden Bridge', buzz: 'The hands' }] } });
ok('a spots call becomes a spots block', spotBlock.kind === 'spots' && spotBlock.spots.length === 1);
const propBlock = blockFrom({ id: 'e2', name: 'propose_trip', input: { title: 'Five days', summary: 's', days: [{ label: 'Thu', plan: 'p' }] } });
ok('a proposal becomes its own block kind', propBlock.kind === 'proposal' && !!propBlock.proposal);
ok('a present call with no kind is still ignored', blockFrom({ id: 'e3', name: 'present', input: {} }) === null);

const PROPOSAL = {
  role: 'block', id: 'b1', kind: 'proposal', title: 'Five days in Da Nang', items: [], facts: [], spots: [], choose: false,
  proposal: {
    title: 'Five days in Da Nang',
    summary: 'One base at Furama so nobody repacks. Beach mornings, one big day out midweek.',
    days: [
      { label: 'Thu 10 Sep — arrive', plan: 'Land 09:15, bags at the resort, beach and an early night.' },
      { label: 'Fri 11 Sep', plan: 'Marble Mountains before the heat, then the pool.' },
    ],
    stays: ['Furama Resort, all 4 nights'],
    cost: 'About RM6,400 all in, excluding flights.',
    unsure: ['Ba Na Hills tickets sell out on weekends — worth booking ahead.'],
  },
};
const OPTIONS = {
  role: 'block', id: 'b3', kind: 'options', title: 'Three that fit', items: [
    { name: 'Furama Resort', price: 'RM420/night', rating: '4.6 on Google, 2,318 reviews',
      meta: 'Bac My An beach, 10 min from the airport',
      why: 'The only one with a pool shallow enough for Nur.',
      link: 'https://furamavietnam.com/' },
    { name: 'Sala Danang', price: 'RM280/night',
      meta: 'My Khe, across the road from the sand',
      why: 'Cheapest of the three and still on the beach.' },
  ], facts: [], spots: [], choose: true, proposal: null,
};
const SPOTS = {
  role: 'block', id: 'b2', kind: 'spots', title: 'What people are photographing', items: [], facts: [], choose: false,
  spots: [{
    name: 'Golden Bridge, Ba Na Hills',
    buzz: 'The giant stone hands holding the walkway. Still all over TikTok — the shot everyone does is from the far end looking back.',
    meta: '25km west, about an hour each way',
    best: 'First cable car at 8am, before the coach parties',
    watch: 'A full day and not cheap — around 900,000 VND each with the cable car.',
    tags: ['famous', 'day trip'],
  }],
};

const browser = await chromium.launch();
const errs = [];
let sent = null;
const scenario = async (state) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: state }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  return { ctx, page };
};

const base = {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: null, agentEdits: [], building: false, thinking: false, turns: 1,
  plan: { destination: 'Da Nang', dates: '10-14 Sep', who: 'Aisyah, Adam (6)', budget: 'RM400/night', shape: 'Relaxed' },
};

// --- the proposal gate ----------------------------------------------------
{
  const { ctx, page } = await scenario({ ...base, transcript: [...base.transcript, PROPOSAL] });
  ok('the proposal renders as its own card', await page.locator('.prop').count() === 1);
  const txt = await page.locator('.prop').innerText();
  ok('it shows the shape of each day', txt.includes('Land 09:15'));
  ok('it shows where they sleep', txt.includes('Furama'));
  ok('it shows the cost', txt.includes('RM6,400'));
  ok('it does not hide what is unsure', txt.includes('sell out on weekends'));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/proposal.png' });

  await page.locator('.prop button:has-text("Change something")').click();
  await page.waitForTimeout(400);
  ok('asking for changes goes back to the agent', !!sent && /change something/i.test(sent.text));

  await page.locator('.prop button:has-text("Build my itinerary")').click();
  await page.waitForTimeout(400);
  ok('accepting is what triggers the build', !!sent && /build it/i.test(sent.text));
  ok('no horizontal overflow at 390px',
     (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await ctx.close();
}

// --- what makes a recommendation worth trusting --------------------------
{
  const { ctx, page } = await scenario({ ...base, transcript: [...base.transcript, OPTIONS] });
  ok('a rating is shown where there is one',
     (await page.locator('.opt').first().innerText()).includes('4.6 on Google'));
  ok('and how many reviews it rests on',
     (await page.locator('.opt').first().innerText()).includes('2,318'));
  ok('a place without one simply has none',
     await page.locator('.opt').nth(1).locator('.rating').count() === 0);

  // Somewhere named should never be a dead end.
  ok('its own page is linked when known',
     await page.locator('.opt').first().locator('a[href="https://furamavietnam.com/"]').count() === 1);
  ok('and there is always a map link',
     await page.locator('.opt').first().locator('.links a').last().count() === 1);
  ok('even for the one with no site of its own',
     await page.locator('.opt').nth(1).locator('.links a').last().count() === 1);
  const href = await page.locator('.opt').nth(1).locator('.links a').last().getAttribute('href');
  ok('and it searches for the place, in the right city',
     href.includes('Sala%20Danang') && href.includes('Da%20Nang'), decodeURIComponent(href));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/ratings.png' });
  await ctx.close();
}

// --- viral spots ----------------------------------------------------------
{
  const { ctx, page } = await scenario({ ...base, transcript: [...base.transcript, SPOTS] });
  const txt = await page.locator('.spot').innerText();
  ok('a spot says what the shot actually is', txt.includes('far end looking back'));
  ok('and when to go for it', txt.includes('before the coach parties'));
  ok('and is honest about the catch', txt.includes('900,000 VND'));
  await page.locator('.spot button:has-text("Add this")').click();
  await page.waitForTimeout(400);
  ok('adding one continues the conversation', !!sent && sent.text.includes('Golden Bridge'));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/spots.png' });
  await ctx.close();
}

// --- the attachment nudge -------------------------------------------------
{
  const { ctx, page } = await scenario(base);   // flights and stays both open
  ok('the nudge appears while a booking would help', await page.locator('.hint').count() === 1);
  ok('it says what to send', (await page.locator('.hint').innerText()).includes('screenshot'));
  ok('the composer says it too', await page.locator('textarea').getAttribute('placeholder') === 'Reply, or attach a booking');
  await page.locator('.hint button').click();
  await page.waitForTimeout(250);
  ok('dismissing it sticks', await page.locator('.hint').count() === 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  ok('and it stays dismissed after a reload', await page.locator('.hint').count() === 0);
  await ctx.close();
}

// --- and it knows when to stay quiet --------------------------------------
{
  const { ctx, page } = await scenario({
    ...base,
    plan: { ...base.plan, stays: 'Furama, booked', flights: 'AK1498, 10 Sep' },
  });
  ok('no nudge once bookings are in', await page.locator('.hint').count() === 0);
  await ctx.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
