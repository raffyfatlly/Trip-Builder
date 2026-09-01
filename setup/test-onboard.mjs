// The onboarding steps, and the planning checklist that replaced building on
// four facts. Production build, stubbed API — no agent, no cost.
//
//   npx next build && npx next start -p 3215
//   BASE=http://localhost:3215 node setup/test-onboard.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { seedMessage } from '../lib/onboarding.js';
import { planFrom, missing, noteResult } from '../lib/plan.js';

const B = process.env.BASE || 'http://localhost:3215';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the seed message, without a browser ----------------------------------
ok('seed reads like a person wrote it',
   seedMessage({ destination: 'Da Nang, Vietnam', when: { start: '2026-09-10', end: '2026-09-14' },
                 who: { list: [{ name: 'Aisyah' }, { name: 'Adam', age: '6' }] }, about: ['Rest and beach'] })
   === "We're going to Da Nang, Vietnam. 10 September 2026 to 14 September 2026, 4 nights. It's Aisyah, Adam (6). Mainly about rest and beach.");
ok('an empty form still produces something sendable', seedMessage({}).length > 10);
ok('rough dates survive', seedMessage({ when: { rough: 'September' } }).includes('around September'));

// --- the plan replays from the log ----------------------------------------
const note = (input) => ({ type: 'agent.custom_tool_use', name: 'note_plan', input });
const plan = planFrom([
  note({ destination: 'Da Nang', who: 'Aisyah, Adam (6)' }),
  note({ dates: '10-14 Sep' }),
  note({ destination: 'Da Nang, Vietnam' }),          // refined later
  { type: 'agent.custom_tool_use', name: 'present', input: { kind: 'options' } },
]);
ok('later notes refine earlier ones', plan.destination === 'Da Nang, Vietnam');
ok('a note that omits a slot does not clear it', plan.who === 'Aisyah, Adam (6)');
ok('what is still open is tracked', missing(plan).join(',') === 'stays,budget,flights,shape');
ok('the agent is told not to build yet', noteResult(plan).includes('do not build yet'));
const full = planFrom([note({ destination: 'a', dates: 'b', who: 'c', stays: 'd', budget: 'e', flights: 'f', shape: 'g', ready: true })]);
ok('and told to build when it is all there', noteResult(full).includes('build it'));

// --- the flow in a browser -------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
let sent = null;
let state = { transcript: [], itinerary: null, plan: {}, agentEdits: [], building: false, thinking: false, turns: 0 };
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_NEW' } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: state }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

ok('a new trip starts with onboarding, not an empty box', await page.locator('.ob').count() === 1);
ok('the composer is out of the way while onboarding', await page.locator('.composer').count() === 0);

await page.locator('.obchip:has-text("Da Nang")').click();
await page.locator('.obnext').click();
await page.waitForTimeout(300);
await page.locator('input[type=date]').first().fill('2026-09-10');
await page.locator('input[type=date]').nth(1).fill('2026-09-14');
await page.locator('.obnext').click();
await page.waitForTimeout(300);
await page.locator('.whorow input').first().fill('Aisyah');
await page.locator('.obnext').click();
await page.waitForTimeout(300);

// raffy, 2026-09-01: "depending whether user has already some of these
// confirmed/book before they engage" and "some people might prefer to have
// really pack schedule... for some want a more relax itenary".
ok('it asks what is already booked', await page.locator('.ready .obchip:has-text("Flights")').count() === 1);
ok('and how full they like their days', await page.locator('.ready .pace').count() === 3);
await page.locator('.ready .obchip:has-text("Flights")').click();
await page.locator('.pace:has-text("Slow")').click();
await page.waitForTimeout(150);
ok('picking a pace selects exactly one', await page.locator('.pace.on').count() === 1);
await page.locator('.obnext').click();
await page.waitForTimeout(300);
await page.locator('.obchip:has-text("Photos")').click();
ok('the last step offers to start', (await page.locator('.obnext').innerText()).includes('Start planning'));
await page.locator('.obnext').click();
await page.waitForTimeout(800);
ok('the answers are sent as the first message', !!sent && sent.text.includes('Da Nang') && sent.text.includes('Aisyah'));
ok('including what is already booked', /already sorted: flights/i.test(sent.text), sent.text);
ok('and the pace they want', /slow/i.test(sent.text), sent.text);
ok('and it lands in the chat, not a form', await page.locator('.composer').count() === 1);
ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
await ctx.close();

// --- skipping --------------------------------------------------------------
{
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_NEW2' } }));
  await c2.route('**/api/state**', (r) => r.fulfill({ json: state }));
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(B, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1300);
  await p2.locator('.skipall').click();
  await p2.waitForTimeout(300);
  ok('Skip drops you straight into the chat', await p2.locator('.composer').count() === 1);
  ok('and the onboarding is gone', await p2.locator('.ob').count() === 0);
  await c2.close();
}

// --- who's coming, when the profile already knows -------------------------
//
// raffy, 2026-09-01: "if profile have been saved can give the option from the
// saved info for easy click so no need to fill if same info."
{
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let sent4 = null;
  await c4.addInitScript(() => {
    localStorage.setItem('itin.memory.v1', JSON.stringify({
      v: 1, at: Date.now(), name: 'Aisyah',
      people: [
        { name: 'Aisyah' },
        { name: 'Adam', bornAbout: 2020 },
        { name: 'Nur', bornAbout: 2023 },
      ],
    }));
  });
  await c4.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_MEM' } }));
  await c4.route('**/api/state**', (r) => r.fulfill({ json: state }));
  await c4.route('**/api/send', (r) => { sent4 = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  const p4 = await c4.newPage();
  p4.on('pageerror', (e) => errs.push(e.message));
  await p4.goto(B, { waitUntil: 'networkidle' });
  await p4.waitForTimeout(1300);

  await p4.locator('.obchip:has-text("Da Nang")').click();
  await p4.locator('.obnext').click();
  await p4.waitForTimeout(250);
  await p4.locator('.obnext').click();          // dates: skipped
  await p4.waitForTimeout(300);

  console.log('');
  ok('the saved crew is offered', (await p4.locator('.obchip.person').count()) === 3);
  ok('and nobody has to be typed in', (await p4.locator('.whorow').count()) === 0);
  ok('everyone starts included', (await p4.locator('.obchip.person.on').count()) === 3);
  // The age is stored as a birth year, so it moves on its own.
  ok('ages are counted forward, not remembered stale',
     (await p4.locator('.obchip.person:has-text("Adam")').innerText()).includes(String(new Date().getUTCFullYear() - 2020)));
  await p4.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/onboard-saved.png' });

  // One tap is enough to leave someone at home.
  await p4.locator('.obchip.person:has-text("Nur")').click();
  await p4.waitForTimeout(150);
  ok('tapping one takes them off', (await p4.locator('.obchip.person.on').count()) === 2);
  ok('and they are still offered back', (await p4.locator('.obchip.person').count()) === 3);
  await p4.locator('.obchip.person:has-text("Nur")').click();
  await p4.waitForTimeout(150);
  ok('tapping again puts them back', (await p4.locator('.obchip.person.on').count()) === 3);
  await p4.locator('.obchip.person:has-text("Nur")').click();
  await p4.waitForTimeout(150);

  // Someone new still works alongside the saved ones.
  await p4.locator('.addwho').click();
  await p4.waitForTimeout(150);
  await p4.locator('.whorow input').first().fill('Mak');
  await p4.locator('.obnext').click();
  await p4.waitForTimeout(250);
  await p4.locator('.obnext').click();          // already sorted: skipped
  await p4.waitForTimeout(250);
  await p4.locator('.obnext').click();
  await p4.waitForTimeout(700);

  const t4 = (sent4 || {}).text || '';
  ok('the seed names who is actually coming', /Aisyah, Adam \(\d+\), Mak/.test(t4), t4);
  ok('and leaves out who is not', !t4.includes('Nur'), t4);
  await c4.close();
}

// --- the checklist ---------------------------------------------------------
{
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let s3 = null;
  await c3.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_P' } }));
  await c3.route('**/api/send', (r) => { s3 = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  await c3.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: null,
    plan: { destination: 'Da Nang, Vietnam', dates: '10-14 Sep', who: 'Aisyah, Adam (6)', shape: 'Relaxed' },
    agentEdits: [], building: false, thinking: false, turns: 1,
  } }));
  const p3 = await c3.newPage();
  p3.on('pageerror', (e) => errs.push(e.message));
  await p3.goto(B, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1300);

  ok('the checklist shows progress', (await p3.locator('.ptext').innerText()).includes('4 of 7'));
  // The destination names the trip long before anything is built — a sentence
  // they typed is not a name.
  ok('the trip is named by its destination, not the first thing typed',
     (await p3.locator('header .where').innerText()).trim() === 'Da Nang, Vietnam');
  ok('and that is what the trip list stores',
     (await p3.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]')))
       .some((t) => t.label === 'Da Nang, Vietnam'));
  ok('it does not float over the chat', await p3.locator('.plan').evaluate((el) => getComputedStyle(el).position) === 'static');
  await p3.locator('.planbar').click();
  await p3.waitForTimeout(250);
  ok('open, it names what is still missing', (await p3.locator('.planlist').innerText()).includes('Where they sleep'));
  ok('and shows what is settled', (await p3.locator('.planlist').innerText()).includes('Da Nang, Vietnam'));
  ok('building early is offered, not forced',
     (await p3.locator('.buildnow').innerText()).includes('3 still open'));
  await p3.locator('.buildnow').click();
  await p3.waitForTimeout(500);
  ok('and it asks the agent rather than bypassing it', !!s3 && /build it now/i.test(s3.text));
  await c3.close();
}

// --- once built, the checklist steps aside ---------------------------------
{
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const REAL = JSON.parse((await import('fs')).readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
  await c4.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_B' } }));
  await c4.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: REAL,
    plan: { destination: 'Da Nang', dates: 'x', who: 'y', stays: 'z', budget: 'b', flights: 'f', shape: 's', ready: true },
    agentEdits: [], building: false, thinking: false, turns: 1,
  } }));
  const p4 = await c4.newPage();
  p4.on('pageerror', (e) => errs.push(e.message));
  await p4.goto(B, { waitUntil: 'networkidle' });
  await p4.waitForTimeout(1400);
  ok('the checklist disappears once the itinerary exists', await p4.locator('.plan').count() === 0);
  await c4.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
