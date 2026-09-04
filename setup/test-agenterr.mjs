// The turn that died, and the silence that followed it.
//
// Found by planning a trip in the app rather than by reading the code: a reply
// never came, the typing dots vanished, and the thread sat there. In the event
// log was a session.error — the API credit had run out — and nothing in this
// codebase read that event type. A transient failure looked exactly like
// thinking, and then exactly like nothing.
//
// It is the worst failure the app can have, because the traveller cannot tell
// it from a slow answer. They wait, then they leave.
//
//   BASE=http://localhost:3241 node setup/test-agenterr.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { agentError } from '../lib/managedAgents.js';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const err = (message) => ({ type: 'session.error', error: { message } });

console.log('');
{
  const billing = agentError([{ type: 'user.message' }, { type: 'agent.tool_use' },
    err('Your credit balance is too low to access the Anthropic API.'), { type: 'session.status_idle' }]);
  ok('a dead turn is reported at all', !!billing);
  ok('running out of credit is known for what it is', billing.kind === 'billing');
  // The raw message names an account that is not theirs and asks them to go and
  // top it up. Saying that to a traveller is worse than saying nothing.
  ok('and the traveller is not sent to a billing page',
     !/Plans & Billing|upgrade|purchase/i.test(billing.say), billing.say);
  ok('but is told it is not their fault', /Nothing you did/.test(billing.say));
  ok('and is not offered a retry that cannot work', billing.retry === false);

  const busy = agentError([{ type: 'user.message' }, err('Overloaded: too many requests')]);
  ok('a busy model is a different thing', busy.kind === 'busy');
  ok('and that one is worth retrying', busy.retry === true);

  const other = agentError([{ type: 'user.message' }, err('upstream connect error')]);
  ok('anything else still says something', other.kind === 'other' && other.retry === true, other.say);

  // An error the agent recovered from is history, not news.
  ok('an error it recovered from is not reported',
     agentError([{ type: 'user.message' }, err('boom'), { type: 'agent.message' }]) === null);
  // Nor is one from a turn that is already over.
  ok('nor is one from a previous turn',
     agentError([{ type: 'user.message' }, err('boom'), { type: 'agent.message' },
       { type: 'user.message' }, { type: 'agent.message' }]) === null);
  ok('and a healthy conversation reports nothing',
     agentError([{ type: 'user.message' }, { type: 'agent.message' }]) === null);
  ok('an empty log is not an error', agentError([]) === null);
}

// --- and the traveller can see it -------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
let advanced = 0;
let agentErrPayload = { kind: 'other', say: 'Something went wrong on my side and that reply never arrived. Send it again and I will pick it up.', retry: true };
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/advance**', (r) => { advanced++; r.fulfill({ json: { ok: true } }); });
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'plan the days please', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, steps: [], agentError: agentErrPayload, turns: 1 } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

console.log('');
const box = page.locator('.agenterr');
ok('the thread says the turn failed', (await box.count()) === 1);
ok('in words, not a spinner', /never arrived/.test(await box.innerText()));
ok('with a way to pick it back up', (await page.locator('.agenterr .aeb').count()) === 1);

const before = advanced;
await page.locator('.agenterr .aeb').click();
await page.waitForTimeout(600);
ok('and the retry actually advances the turn', advanced > before,
   (advanced - before) + ' advance calls');
ok('rather than making them retype it',
   !(await page.locator('textarea').first().inputValue()));

// Billing cannot be retried, so it must not offer to.
agentErrPayload = { kind: 'billing', say: 'I have run out of credit on my side, so I could not finish that. Nothing you did — it needs topping up before I can keep planning.', retry: false };
await page.waitForTimeout(2600);
ok('a billing failure still says what happened', (await page.locator('.agenterr').count()) === 1);
ok('but offers no button that cannot work', (await page.locator('.agenterr .aeb').count()) === 0);

ok('no page errors', errs.length === 0, errs.join(' / '));
await page.screenshot({ path: 'shots/agent-error.png' });
await browser.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
