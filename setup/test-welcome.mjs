// The real landing page: public/welcome/index.html's ask box, and that
// "Plan a trip" is a plain handoff — against a mocked backend.
//
//   BASE=http://localhost:3241 node setup/test-welcome.mjs
//
// raffy, 2026-09-16, after two earlier attempts landed this in the wrong
// place entirely: "i actually want it on the landing page. here." — a
// screenshot of THIS page. Then: "trigger sign up/signin button like usual
// for unregistered user /visitor. like before. and for the question no
// need to keep cause it might affect going forward." So "Plan a trip" is
// checked here as a PLAIN link to / — no seed, no auto-send — leaving the
// existing mustSignIn gate to do exactly what it always did.
//
// raffy, 2026-09-16, a later round: "don't make it auto ask when clicking
// the buttons. just as placeholder." — the topic pills used to fill AND
// fire the question; now they only swap the input's placeholder. And:
// "make the generated answer looks nice like the chat" — the answer is
// now rendered through the same price/link/bold/list treatment
// components/Rich.js gives a real chat message, ported in plain JS since
// this page is static and can't import lib/richtext.js from the browser.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3241';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];

let hookCalls = 0;
let lastBody = null;

await ctx.route('**/api/hook', (r) => {
  hookCalls++;
  lastBody = JSON.parse(r.request().postData());
  ok('a stable per-browser id rides along, not a real session', /^w_/.test(lastBody.session || ''), lastBody.session);
  ok('the browser timezone rides along too, same as the chat agent gets',
     !!(lastBody.client && lastBody.client.tz), JSON.stringify(lastBody.client));
  // The first "paragraph" here has ordinary mid-sentence line wraps (single
  // \n, not a blank line) — raffy, 2026-09-16, with a screenshot: this used
  // to come back as one fragment of a sentence per line, each with its own
  // paragraph gap under it. Only the blank line before the list should
  // start a new block.
  r.fulfill({ json: {
    answer: 'Da Nang and Nha Trang both work\nwell in September. Check [Klook](https://www.klook.com/da-nang)\nfor tours, or call +60 3-2113 1888 for the local desk.\n\n- Flights: KUL to DAD direct, about RM450-650 return\n- Stay: Furama or Vinpearl both work well for a relaxed week',
    share: 'testtoken000000000001',
  } });
});

// A failed /api/hook must never silently punt them into /, where an old
// session — real for anyone who has used this before — would show up with
// no explanation at all. raffy, 2026-09-16: "it didn't give answer like
// before. it bring directly to chat session, which contains some of my
// past question." Checked in its own context so the failing route here
// never leaks into the success-path checks below.
const errCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await errCtx.route('**/api/hook', (r) => r.fulfill({ status: 500, json: { error: 'boom' } }));
const errPage = await errCtx.newPage();
await errPage.goto(B + '/welcome', { waitUntil: 'networkidle' });
await errPage.locator('#askinput').fill('Any hidden gems in Bali?');
await errPage.locator('#askform').evaluate((el) => el.requestSubmit());
await errPage.locator('#askerr').waitFor({ state: 'visible', timeout: 5000 });
ok('a failed lookup shows an inline error, not a silent redirect',
   (await errPage.locator('#askerr').innerText()).length > 0);
ok('and it stays on the landing page rather than jumping to /',
   errPage.url().includes('/welcome'));
await errCtx.close();

// No token (e.g. Firestore not configured on this deployment) must not
// offer a link that would 404 — the button just stays hidden.
const noShareCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await noShareCtx.route('**/api/hook', (r) => r.fulfill({ json: { answer: 'A plain answer with nothing to share.' } }));
const noSharePage = await noShareCtx.newPage();
await noSharePage.goto(B + '/welcome', { waitUntil: 'networkidle' });
await noSharePage.locator('#askinput').fill('Any hidden gems in Kyoto?');
await noSharePage.locator('#askform').evaluate((el) => el.requestSubmit());
await noSharePage.locator('#askanswer').waitFor({ state: 'visible', timeout: 5000 });
ok('no share button when the answer came back without a token',
   !(await noSharePage.locator('#askshare').isVisible()));
await noShareCtx.close();

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B + '/welcome', { waitUntil: 'networkidle' });

// The section introduces itself, same as every other one on the page.
ok('the ask box has its own header', (await page.locator('.askhead').innerText()).length > 0);

// raffy, 2026-09-16: "don't make it auto ask when clicking the buttons.
// just as placeholder." A chip only swaps the placeholder and focuses the
// field — nothing is sent, and the field stays empty.
const foodQ = await page.locator('.cat', { hasText: 'Food' }).getAttribute('data-q');
await page.locator('.cat', { hasText: 'Food' }).click();
ok('a topic chip does not fire a question on its own', hookCalls === 0, String(hookCalls));
ok('it sets the placeholder to that topic\'s example instead',
   (await page.locator('#askinput').getAttribute('placeholder')) === foodQ);
ok('and leaves the field itself empty', (await page.locator('#askinput').inputValue()) === '');
ok('the field is focused, ready to type into',
   await page.locator('#askinput').evaluate((el) => el === document.activeElement));

// Typing a real question and submitting is what actually asks.
await page.locator('#askinput').fill('What street food should I try in Da Nang?');
await page.locator('#askform').evaluate((el) => el.requestSubmit());
await page.locator('#askanswer').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to the hook endpoint', hookCalls === 1, String(hookCalls));
ok('the typed question is what reached the server',
   lastBody.question.includes('street food should I try in Da Nang'), lastBody.question);
ok('the answer is shown', (await page.locator('#askanswerbody').innerText()).includes('Da Nang and Nha Trang'));
ok('the box loses its pill shape once it has answered',
   await page.locator('#askform').evaluate((el) => el.classList.contains('answered')));
ok('there is no "ask something else" option', await page.locator('#askagain').count() === 0);

// raffy, 2026-09-16: "make the generated answer looks nice like the chat" —
// same price/link treatment components/Rich.js gives a real chat message.
ok('a price is picked out the way the chat highlights one',
   (await page.locator('#askanswerbody .cost').first().innerText()).includes('RM450'));
ok('a markdown link becomes a tappable chip, not a raw URL',
   await page.locator('#askanswerbody a.chip', { hasText: 'Klook' }).count() === 1);
ok('a phone number becomes a tel: chip',
   await page.locator('#askanswerbody a.chip.call').count() === 1);
// raffy, 2026-09-16, with a screenshot: a sentence with ordinary mid-line
// wraps used to render as one separate paragraph per line. A blank line —
// not a lone \n — is what should start a new paragraph.
ok('mid-sentence line wraps join into one paragraph, not one per line',
   await page.locator('#askanswerbody p').first().evaluate((el) => /well in September/.test(el.textContent) && /local desk/.test(el.textContent)));
ok('and the whole answer is not one paragraph per source line',
   await page.locator('#askanswerbody p').count() === 1);

// raffy, 2026-09-17: "i want to share the real answer it give in the form
// of visual link... so they might be intrigue to explore the app." The
// token comes from /api/hook itself (lib/answershare.js mints it from the
// real answer, server-side) — the button just builds the link from it.
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
ok('a share button appears once a real answer comes with a token',
   await page.locator('#askshare').isVisible());
await page.locator('#askshare').click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
ok('clicking it copies the /a/<token> link (no native share sheet in a headless browser)',
   copied.endsWith('/a/testtoken000000000001'), copied);
ok('the button says so afterwards',
   (await page.locator('#asksharelabel').innerText()) === 'Link copied!');

// "Plan a trip" goes to /?new=1 now — no seed, no state carried, and the
// flag tells pages/index.js to ignore whatever stale session this browser
// already had rather than silently resuming it. raffy, 2026-09-16, with a
// screenshot: "i still see my past session (not signed in) when i click
// plan trip."
await Promise.all([
  page.waitForURL('**/?new=1'),
  page.locator('#askplanbtn').click(),
]);
const seedLeft = await page.evaluate(() => {
  try { return localStorage.getItem('itin.seed'); } catch (e) { return null; }
});
ok('the question is not carried into localStorage', seedLeft === null, String(seedLeft));

// The real app, on an ordinary fresh visit with nothing seeded: this is the
// exact regression "messed my chat agent" was about, still checked here.
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_WELCOME' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/log', (r) => r.fulfill({ json: { ok: true } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [], party: null,
  credits: { left: 88, granted: 100, used: 0, plan: 'starter', buildCost: 25, paid: true, signedIn: '' },
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 0 } }));
let sent = null;
await ctx.route('**/api/send', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true, spoke: true } }); });
await page.goto(B + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

ok('a plain landing on / with accounts off starts onboarding as before',
   await page.locator('.ob').count() === 1);
ok('and sends nothing on its own', sent === null, JSON.stringify(sent));

await page.screenshot({ path: 'shots/welcome-answered.png' });

// raffy, 2026-09-17, after catching an early draft that gave the shared
// link its own separate page: "I want the link bring to the answer on the
// landing page." pages/a/[token].js redirects a real click to exactly
// this URL; this checks what a real visitor sees once they land here,
// against a mocked /api/answer rather than a real Firestore round trip.
const sharedCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
let answerCalls = 0;
await sharedCtx.route('**/api/answer**', (r) => {
  answerCalls++;
  ok('the stored token from the URL is what gets asked for',
     r.request().url().includes('token=shared_test_tok_01'));
  r.fulfill({ json: {
    question: 'Which Penang stall locals queue for?',
    answer: 'Try Nam Heong on Kimberley Street.',
  } });
});
const sharedPage = await sharedCtx.newPage();
await sharedPage.goto(B + '/welcome?a=shared_test_tok_01', { waitUntil: 'networkidle' });
await sharedPage.locator('#askanswer').waitFor({ state: 'visible', timeout: 5000 });
ok('exactly one call went to /api/answer, none to /api/hook', answerCalls === 1);
ok('the stored answer is shown, no question needed to be typed',
   (await sharedPage.locator('#askanswerbody').innerText()).includes('Nam Heong'));
ok('the ask row is hidden, same as after a live answer',
   await sharedPage.locator('#askrow').isHidden());
ok('the share button reuses the SAME token rather than needing a new one',
   await sharedPage.locator('#askshare').isVisible());
await sharedCtx.close();

ok('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
