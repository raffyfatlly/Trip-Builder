// A trip on somebody else's account says so, instead of a blank screen.
//
// raffy, 2026-09-07: "my last session give error again. can't access the chat."
//
// /api/state answers 403 when the trip belongs to another account — which is
// what happens after signing in and out on somebody else's phone, exactly what
// he does. The poll threw, the catch counted it as a stall, and it retried every
// two seconds forever. The only banner that mentions a stall renders while the
// agent is thinking, and a trip that never loaded is not thinking, so the screen
// said nothing at all. A permanent lockout that looked like a slow connection.
//
// Needs the app on :3000.  node setup/test-blocked.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const APP = process.env.APP || 'http://localhost:3000';
const S = 'sesn_01LOCKEDOUT0000000000';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();

const open = async (status, body) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errs = [];
  let polls = 0;
  page.on('pageerror', (e) => errs.push(e.message));
  await ctx.route('**/api/state**', (r) => {
    polls++;
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route('**/api/session**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ session: S }) }));
  await ctx.route('**/api/me**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: true, user: null, trips: [], memory: null }) }));
  await ctx.route('**/api/advance**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/api/log**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(APP + '/?s=' + S, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);   // several poll intervals
  return { ctx, page, errs, polls: () => polls };
};

console.log('\nA trip that belongs to another account');
{
  const { ctx, page, errs, polls } = await open(403, { error: 'That trip is not shared with you.' });
  const text = (await page.textContent('body')) || '';
  ok('it says so, rather than sitting blank', /another account/i.test(text), text.slice(0, 120));
  ok('and repeats what the server said', /not shared with you/i.test(text));
  ok('it offers a way out', /Sign in/.test(text) && /Start a new trip/.test(text));
  ok('the session id is on screen, so a screenshot is enough to debug it',
    text.includes(S));
  // The whole point: it stops. Before, this polled forever.
  const n = polls();
  await page.waitForTimeout(4000);
  ok('and it STOPS polling — a refusal will not recover', polls() === n, n + ' then ' + polls());
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/blocked-403.png' });
  await ctx.close();
}

console.log('\nA trip that is gone');
{
  const { ctx, page, errs } = await open(404, { error: 'No such trip.' });
  const text = (await page.textContent('body')) || '';
  ok('says it is not here', /not here/i.test(text), text.slice(0, 120));
  // Scoped to the panel: the header carries its own Sign in button, and the
  // first version of this assertion matched that instead.
  ok('and does not offer a sign-in that cannot help',
    (await page.locator('.blocked .go').count()) === 0);
  ok('but still offers the way out that can', /Start a new trip/.test(text));
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

console.log('\nA real blip still retries');
{
  const { ctx, page, errs, polls } = await open(500, { error: 'boom' });
  const text = (await page.textContent('body')) || '';
  ok('no lockout panel for a server error', !/another account/i.test(text));
  ok('and it keeps trying', polls() > 1, polls() + ' polls');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
