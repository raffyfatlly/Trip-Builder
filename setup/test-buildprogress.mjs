// The card has to move while the builder is working.
//
// raffy, 2026-09-09, after a Melbourne build that worked perfectly: "i didn't
// see it progress means the status change need to be enhance."
//
// He is right, and nothing was broken. The six stages are read off the
// ITINERARY, and a Managed Agents builder writes the itinerary in one
// save_itinerary call near the end — so for most of a build there is genuinely
// nothing to tick. The card sat at "0 of 6" for minutes and then jumped to six.
// The stages are blind to the half of the work that happens before a save.
//
//   BASE=http://localhost:3241 node setup/test-buildprogress.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { builderDoing } from '../lib/managedAgents.js';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

console.log('\nwhat the builder says it is doing');
{
  // The real shapes: a call still waiting on us is what it is on; one already
  // answered is done and something else is current.
  ok('an outstanding call is what it is on',
     builderDoing([{ type: 'agent.custom_tool_use', id: 'a', name: 'find_photos' }])
       === 'Finding the photographs');
  ok('and the newest outstanding one wins',
     builderDoing([
       { type: 'agent.custom_tool_use', id: 'a', name: 'find_photos' },
       { type: 'user.custom_tool_result', custom_tool_use_id: 'a' },
       { type: 'agent.custom_tool_use', id: 'b', name: 'save_itinerary' },
     ]) === 'Writing your days');
  ok('a server-side search counts too',
     builderDoing([{ type: 'agent.tool_use', name: 'web_search' }]) === 'Reading up on the area');
  ok('and nothing to report says nothing, rather than inventing',
     builderDoing([]) === '' && builderDoing([{ type: 'agent.message' }]) === '');
}

// And on screen: the blind window is exactly when the card must not look dead.
const shot = async (state) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_P' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/advance**', (r) => r.fulfill({ json: { ok: true } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'build it', id: 'u1' }],
    plan: {}, agentEdits: [], memoryOps: [], thinking: false, steps: [], turns: 1, ...state } }));
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  return { page, ctx };
};

const browser = await chromium.launch();
console.log('\nthe first minutes, before anything is saved');
{
  const { page, ctx } = await shot({
    itinerary: null, building: true,
    progress: { step: 3, steps: 14, doing: 'Reading up on the area' },
  });
  const card = page.locator('.prog').first();
  ok('the card is up', await card.count() > 0);
  ok('and it says what the builder is on', /Reading up on the area/.test(await card.innerText()),
     (await card.innerText()).split('\n').slice(0, 3).join(' | '));
  ok('the stages are honestly still at zero', /0 of 6/.test(await card.innerText()));
  // The bar must not be a flat dead zero, and must not claim a stage either.
  const w = await page.locator('.prog .bbar i').first().evaluate(
    (el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
  ok('the bar has moved off zero', w > 0.01, (w * 100).toFixed(1) + '%');
  ok('but has not reached the first stage', w < 1 / 6, (w * 100).toFixed(1) + '%');
  await ctx.close();
}

console.log('\nonce the trip lands');
{
  const it = { trip: { title: 'Melbourne' }, days: [{ items: [{ h: 'A' }] }], stays: [{ n: 'H', lat: 1, lon: 2 }], photos: { a: 'x' } };
  const { page, ctx } = await shot({
    itinerary: it, building: true,
    progress: { step: 11, steps: 14, doing: 'Adding the photographs' },
  });
  const card = page.locator('.prog').first();
  ok('the stages take over', /6 of 6|5 of 6/.test(await card.innerText()),
     (await card.innerText()).split('\n')[1]);
  ok('and it still says what it is finishing', /Adding the photographs/.test(await card.innerText()));
  await ctx.close();
}
await browser.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
