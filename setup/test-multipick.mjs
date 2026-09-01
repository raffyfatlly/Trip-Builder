// Picking more than one thing from one card set.
//
// raffy, 2026-09-01, planning two areas of Italy: "i had two area to go. so i
// select 2 places based on suggestion. the issue is, one cklick he responded.
// but i need to click two hotels selcteion." And: "if it has more iption,
// enable multi select option so the agent dont react immediately after user
// choose."
//
//   BASE=http://localhost:3272 node setup/test-multipick.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { blockFrom } from '../lib/blocks.js';

const B = process.env.BASE || 'http://localhost:3272';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the shape ------------------------------------------------------------
const mk = (input) => blockFrom({ id: 'e1', name: 'present', input });
ok('pick defaults to one', mk({ kind: 'options', title: 'x' }).pick === 'one');
ok('many is carried through', mk({ kind: 'options', title: 'x', pick: 'many' }).pick === 'many');
ok('anything else is one', mk({ kind: 'options', title: 'x', pick: 'lots' }).pick === 'one');

// --- in the browser -------------------------------------------------------
const OPTIONS = {
  kind: 'options', title: 'Where to stay in each city', choose: true, pick: 'many',
  intro: 'One in Florence, one in Rome.',
  items: [
    { name: 'Hotel Davanzati', why: 'Central Florence, family rooms.', price: 'RM480/night', rating: '4.8 on Google, 1,900 reviews' },
    { name: 'Palazzo Manfredi', why: 'Looks straight at the Colosseum.', price: 'RM950/night' },
    { name: 'Hotel Artemide', why: 'Quieter, near Termini.', price: 'RM610/night' },
  ],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
let sent = null;
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [
    { role: 'user', text: 'florence and rome', id: 'u1' },
    { ...blockFrom({ id: 'b1', name: 'present', input: OPTIONS }) },
  ],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_X'));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const ticks = page.locator('.opt .pick.tick');
ok('every option is a tick, not a send', await ticks.count() === 3);
ok('the bar says what to do', (await page.locator('.confirm').innerText()).includes('Tick the ones'));
ok('and will not send yet', await page.locator('.confirm .send').isDisabled());

await ticks.nth(0).click();
await page.waitForTimeout(200);
ok('one tick does NOT send', sent === null);
ok('the bar counts it', (await page.locator('.confirm').innerText()).includes('1 picked'));
ok('and now it can send', !(await page.locator('.confirm .send').isDisabled()));

await ticks.nth(2).click();
await page.waitForTimeout(200);
ok('a second tick still does not send', sent === null);
ok('the count follows', (await page.locator('.confirm').innerText()).includes('2 picked'));

// Untick and re-tick: the state is real, not one-way.
await ticks.nth(2).click();
await page.waitForTimeout(150);
ok('ticking again removes it', (await page.locator('.confirm').innerText()).includes('1 picked'));
await ticks.nth(2).click();
await page.waitForTimeout(150);

await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/multipick.png' });
await page.locator('.confirm .send').click();
await page.waitForTimeout(600);

ok('sending goes once, with both', !!sent && /Davanzati/.test(sent.text) && /Artemide/.test(sent.text));
ok('read back in card order, not tap order', !!sent && sent.text.indexOf('Davanzati') < sent.text.indexOf('Artemide'));
ok('and it reads like a sentence', !!sent && sent.text.includes(' and '), sent && sent.text);

// A normal single-pick set is untouched.
await ctx.unroute('**/api/state**');
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [
    { role: 'user', text: 'one city', id: 'u1' },
    { ...blockFrom({ id: 'b2', name: 'present', input: { ...OPTIONS, pick: 'one' } }) },
  ],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));
sent = null;
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
ok('single-pick still sends on one click', await page.locator('.confirm').count() === 0);
await page.locator('.opt .pick').first().click();
await page.waitForTimeout(500);
ok('and it sent', !!sent && /Davanzati/.test(sent.text));

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
