// The memory layer: what is kept, how it ages, and that the person it belongs
// to can see and delete it. Offline — no agent, no cost.
//
//   BASE=http://localhost:3240 node setup/test-memory.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { applyMemory, memoryFrom, memoryBlock, ageNow, isEmpty } from '../lib/memory.js';
import { contextBlock } from '../lib/context.js';

const B = process.env.BASE || 'http://localhost:3240';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const T2026 = Date.UTC(2026, 7, 31);
const T2029 = Date.UTC(2029, 7, 31);

// --- what gets kept -------------------------------------------------------
let m = applyMemory(null, 'remember', {
  people: [{ name: 'Aisyah' }, { name: 'Adam', age: 6 }, { name: 'Nur', age: 3, note: 'naps early afternoon' }],
  home: 'Kuala Lumpur', dietary: 'halal', pace: 'slow with the kids',
}, T2026);

ok('people are kept with their ages', m.people.length === 3 && m.people[1].age === 6);
ok('an adult stays ageless', !('age' in m.people[0]));
ok('the year they were born is what is actually stored', m.people[1].bornAbout === 2020);
ok('durable facts are kept', m.home === 'Kuala Lumpur' && m.dietary === 'halal');

// The point of the whole design: a stale age is worse than no age.
ok('a child is older three years later', ageNow(m.people[1], T2029) === 9);
ok('and the agent is told the age is an estimate',
   memoryBlock(m, T2029).includes('about 9') && memoryBlock(m, T2029).includes('estimated forward'));
ok('an unchanged age is not hedged', memoryBlock(m, T2026).includes('Adam (6)'));

// --- what does not get kept ----------------------------------------------
const before = JSON.stringify(m);
m = applyMemory(m, 'remember', { people: [], home: '   ' }, T2026);
ok('empty updates change nothing', m.home === 'Kuala Lumpur' && m.people.length === 3);
m = applyMemory(m, 'remember', { notes: ['Hates early flights'] }, T2026);
m = applyMemory(m, 'remember', { notes: ['Hates early flights'] }, T2026);
ok('the same note twice is stored once', m.notes.length === 1);
const many = applyMemory(m, 'remember', { notes: Array.from({ length: 30 }, (_, i) => 'note ' + i) }, T2026);
ok('notes are capped so this cannot become a diary', many.notes.length === 12);
ok('a long note is trimmed rather than stored whole',
   applyMemory(null, 'remember', { notes: ['x'.repeat(500)] }, T2026).notes[0].length === 160);
ok('a nonsense age is refused',
   !('age' in applyMemory(null, 'remember', { people: [{ name: 'X', age: 999 }] }, T2026).people[0]));

// --- forgetting -----------------------------------------------------------
const forgot = applyMemory(m, 'forget', { fields: ['dietary'] }, T2026);
ok('forgetting one thing removes it', !forgot.dietary);
ok('and leaves the rest', forgot.people.length === 3 && forgot.home === 'Kuala Lumpur');
ok('an unknown field is ignored, not crashed on',
   !!applyMemory(m, 'forget', { fields: ['nonsense'] }, T2026).home);

// --- replay from the chat log --------------------------------------------
const events = [
  { type: 'agent.custom_tool_use', name: 'remember', input: { home: 'Penang' } },
  { type: 'agent.custom_tool_use', name: 'present', input: { kind: 'facts' } },
  { type: 'agent.custom_tool_use', name: 'forget', input: { fields: ['dietary'] } },
];
const replayed = memoryFrom(events, m);
ok('the log replays onto what was already known', replayed.home === 'Penang' && !replayed.dietary);
ok('other tool calls are ignored', replayed.people.length === 3);
ok('an empty profile reads as empty', isEmpty(null) && isEmpty({ v: 1 }) && !isEmpty(m));

// --- it reaches the agent -------------------------------------------------
const ctx = contextBlock({ country: 'MY', countryName: 'Malaysia', currency: 'MYR (RM)' }, { tz: 'Asia/Kuala_Lumpur' }, m);
ok('the profile rides along with every message', ctx.includes('Adam') && ctx.includes('halal'));
ok('and the agent is told not to recite it', ctx.includes('Never read this list back'));
ok('no profile means no extra block',
   !contextBlock({ country: 'MY' }, { tz: 'UTC' }, null).includes('already know'));

// --- and the person can see and delete it --------------------------------
const browser = await chromium.launch();
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
await ctx2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx2.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx2.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));
const page = await ctx2.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((mem) => {
  localStorage.setItem('itin.session.v1', 'sesn_X');
  localStorage.setItem('itin.memory.v1', JSON.stringify(mem));
}, m);
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.burger').click();
await page.waitForTimeout(400);

ok('it is shown, not hidden', await page.locator('.mem').count() === 1);
const text = await page.locator('.mem').innerText();
ok('in plain words', text.includes('Adam') && text.includes('Kuala Lumpur'));
ok('with a label for each thing', text.includes('TRAVELS WITH') || text.includes('Travels with'));
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/memory.png' });

const rowsBefore = await page.locator('.mrow').count();
await page.locator('.mrow').nth(1).locator('.mx').click();
await page.waitForTimeout(300);
ok('one line can be removed', await page.locator('.mrow').count() === rowsBefore - 1);
ok('and it stays removed', !(await page.evaluate(() => localStorage.getItem('itin.memory.v1'))).includes('Kuala Lumpur'));

await page.locator('.mall').click();
await page.waitForTimeout(300);
ok('and all of it can go at once', await page.locator('.mem').count() === 0);
ok('leaving nothing behind', await page.evaluate(() => localStorage.getItem('itin.memory.v1')) === null);
ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
