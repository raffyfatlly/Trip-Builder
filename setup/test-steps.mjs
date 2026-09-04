// What it has already done, while it is still doing the next thing.
//
// raffy, 2026-09-05: "lets say it's taking a while right , can it leave some of
// the steps or action it taken then continue it's task? or else user might
// think it got stuck or something."
//
// Two halves. stepsNow reads the trail off the real event log, and the chat
// draws it. The rule that has to hold in both is that nothing on the list is
// invented: a step appears because a tool call happened, and it is ticked
// because its result came back.
//
//   BASE=http://localhost:3241 node setup/test-steps.mjs

import assert from 'assert';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { stepsNow, doingNow } from '../lib/managedAgents.js';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- reading the log --------------------------------------------------------
console.log('');
{
  const log = [
    { type: 'user.message', content: [{ type: 'text', text: 'first question' }] },
    { type: 'agent.tool_use', id: 't0', name: 'web_search', input: { query: 'old turn' } },
    { type: 'agent.tool_result', tool_use_id: 't0' },
    { type: 'agent.message' },
    // everything above belongs to a turn that is over
    { type: 'user.message', content: [{ type: 'text', text: 'where should we eat' }] },
    { type: 'agent.tool_use', id: 't1', name: 'web_search',
      input: { query: 'best halal seafood restaurants in Sorrento with a sea view and outdoor tables' } },
    { type: 'agent.tool_result', tool_use_id: 't1' },
    { type: 'agent.tool_use', id: 't2', name: 'web_fetch', input: { url: 'https://www.tripadvisor.com/x/y' } },
    { type: 'agent.tool_result', tool_use_id: 't2' },
    { type: 'agent.custom_tool_use', id: 't3', name: 'present',
      input: { items: [{}, {}, {}], title: 'Three to choose from' } },
    // t3 has no result yet: that is the one it is on
  ];

  const s = stepsNow(log);
  ok('only this turn is on the list', s.length === 3, s.map((x) => x.what).join(' / '));
  ok('a finished step is ticked', s[0].done && s[1].done);
  ok('and the one still running is not', s[2].done === false, JSON.stringify(s[2]));

  ok('a search shows what it searched for', /halal seafood/.test(s[0].detail), s[0].detail);
  // Long enough to be useful, short enough to be one line on a phone.
  ok('and the query is cut, not wrapped', s[0].detail.length <= 52, s[0].detail.length + ' chars');
  ok('a page read shows the site', s[1].detail === 'tripadvisor.com', s[1].detail);
  ok('and options say how many', s[2].detail === '3 options', s[2].detail);

  // The list and the one-line status have to agree, or the user sees a step
  // ticked and a status still claiming to be on it.
  ok('the status line agrees with the trail',
     doingNow(log) === 'Putting the options together', doingNow(log));

  // A tool with no traveller-facing name is internal plumbing, not a step.
  const withJunk = log.concat([{ type: 'agent.tool_use', id: 't9', name: 'some_internal_thing', input: {} }]);
  ok('an unnamed tool is not shown', stepsNow(withJunk).length === 3);

  // Twenty searches is not a list anybody reads.
  const many = [{ type: 'user.message' }].concat(
    Array.from({ length: 20 }, (_, i) => ([
      { type: 'agent.tool_use', id: 'm' + i, name: 'web_search', input: { query: 'q' + i } },
      { type: 'agent.tool_result', tool_use_id: 'm' + i },
    ])).flat());
  const cut = stepsNow(many);
  ok('a long turn keeps only the newest few', cut.length === 6, cut.length + ' steps');
  ok('and they are the newest', /q19/.test(cut[cut.length - 1].detail), cut[cut.length - 1].detail);

  // Nothing said yet, nothing done yet.
  ok('a quiet turn has no trail', stepsNow([{ type: 'user.message' }]).length === 0);
  assert.deepEqual(stepsNow([]), []);
}

// --- drawing it -------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
let steps = [
  { id: 'a', what: 'Searched the web', detail: 'ferry Sorrento to Positano timetable', done: true },
  { id: 'b', what: 'Read a page', detail: 'positano.com', done: true },
  { id: 'c', what: 'Put the options together', detail: '3 options', done: false },
];
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/advance**', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'how do we get to Positano', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: true, doing: 'Putting the options together',
  steps, turns: 1 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

console.log('');
const rows = page.locator('.typing .trail li');
ok('the trail is on screen while it works', (await rows.count()) === 3, (await rows.count()) + ' rows');
ok('finished steps are ticked', (await page.locator('.typing .trail li[data-step="done"] .tick svg').count()) === 2);
ok('and the one in flight is not', (await page.locator('.typing .trail li[data-step="now"] .tick svg').count()) === 0);
ok('the running step is the last one',
   (await rows.nth(2).getAttribute('data-step')) === 'now');
ok('it says what it looked for',
   /ferry Sorrento/.test(await rows.nth(0).innerText()), (await rows.nth(0).innerText()).replace(/\n/g, ' '));
ok('the dots are still going, so it reads as working',
   (await page.locator('.typing .dots').count()) === 1);
// The trail already says what it is on. A status line repeating it is noise,
// and the line is kept for the one thing the trail cannot say.
ok('and the status line stops repeating the current step',
   (await page.locator('.typing .says').count()) === 0);

// The thing this is for: it has to grow, or it is just another static line.
steps = steps.map((s) => ({ ...s, done: true })).concat([
  { id: 'd', what: 'Sketched the trip', detail: 'Sorrento & Positano', done: false }]);
await page.waitForTimeout(2600);
ok('and it grows as the work goes on', (await rows.count()) === 4, (await rows.count()) + ' rows');
ok('the step that finished is now ticked',
   (await page.locator('.typing .trail li[data-step="done"]').count()) === 3);

// No trail, no empty box: a turn that calls no tools must look exactly as it
// did before any of this.
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hello', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: true, doing: null, steps: [], turns: 1 } }));
await page.waitForTimeout(2600);
ok('a turn with no steps shows no list', (await page.locator('.typing .trail').count()) === 0);
ok('but still shows it is thinking', (await page.locator('.typing .dots').count()) === 1);
ok('and falls back to saying so in words',
   /Thinking/.test(await page.locator('.typing .says').innerText()));

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
