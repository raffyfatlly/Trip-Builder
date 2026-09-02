// Changing something without leaving the trip.
//
// raffy, 2026-09-01: "include something like want to change the details ? give
// the button to chat , then auto interactive message send to chat . chat agent
// then make the edits... so we don't need the edit isolated section anymore."
//
// The edit pane made changing something a MODE: you left the trip, found the
// same item again in a list of form fields, changed it, and came back. The
// button lives on the item now, inside the preview, and hands the ask to the
// composer with the cursor after it.
//
// Two things this guards. The bridge only exists inside the chat app — a
// downloaded itinerary has no agent to talk to and must not offer one. And the
// ask is HANDED OVER, not sent: "Change dinner:" with nothing after it is a
// question with no question in it.
//
//   BASE=http://localhost:3220 node setup/test-ask.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import zlib from 'zlib';
import { render } from '../renderer/render.js';

const B = process.env.BASE || 'http://localhost:3220';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const browser = await chromium.launch();

// --- standalone: no agent, so no offer of one -------------------------------
{
  const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
  const { html } = render(REAL, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://trip.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://trip.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="days"]').click();
  await page.waitForTimeout(400);
  ok('a downloaded trip offers no Change buttons', (await page.locator('[data-ask]').count()) === 0);
  ok('and still shows the day', (await page.locator('.ev').count()) > 0);
  await ctx.close();
}

// --- inside the chat app -----------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const errs = [];
  const sent = [];
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_A' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: REAL, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  await ctx.route('**/api/send', (r) => { sent.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ json: { ok: true } }); });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_A'));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  ok('the edit mode is gone', (await page.locator('.seg button:has-text("Edit")').count()) === 0);
  ok('the trip is just the trip', (await page.locator('.seg button:has-text("Your trip")').count()) === 1);
  ok('and photos are still one tap away', (await page.locator('.seg button:has-text("Photos")').count()) === 1);

  const frame = page.frameLocator('iframe[title="Itinerary preview"]');
  await frame.locator('#nav button[data-view="days"]').click();
  await page.waitForTimeout(500);

  const asks = frame.locator('[data-ask]');
  ok('every item offers to be changed', (await asks.count()) > 0, (await asks.count()) + ' items');
  ok('and it says so plainly', (await asks.first().innerText()).trim() === 'Change this');

  await asks.first().click();
  await page.waitForTimeout(400);

  // The composer comes to the trip. raffy, 2026-09-01: "i just want the chat
  // continues to live in the app" — bouncing to the chat to type one sentence
  // loses the thing you were looking at, which is the context of the change.
  ok('the composer comes to the trip', (await page.locator('.dock').count()) === 1);
  ok('and the trip is still on screen', await page.locator('.phone iframe').isVisible());

  // raffy, 2026-09-01: "if i just click it and send the chat will respond the
  // message cut off". It used to prefill "Change X on Thu 10: " — a sentence you
  // could send unfinished, and a colon with nothing after it is not an
  // instruction. The context is a label now; the box starts empty.
  ok('the box starts empty', (await page.locator('.dock textarea').inputValue()) === '');
  ok('and says what to type', /later|somewhere|drop/i.test(await page.locator('.dock textarea').getAttribute('placeholder')));

  const label = await page.locator('.dock .dwhat').innerText();
  ok('what you tapped is shown as a label', /Land at Da Nang/.test(label), label.replace(/\n/g, ' '));
  // The chip is styled small-caps, so innerText comes back uppercased — the
  // data underneath is title case, which is what the sent message proves below.
  ok('with the day beside it', /thu 10/i.test(label), label.replace(/\n/g, ' '));

  // Sending an empty ask must be impossible, not merely unhelpful.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('an empty ask cannot be sent', sent.length === 0, JSON.stringify(sent.map((x) => x.text)));

  await page.locator('.dock textarea').fill('make it later');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok('finishing it sends one message', sent.length === 1, JSON.stringify(sent.map((x) => x.text)));
  ok('and the message is whole', /^Change "[^"]+" on \w+ \d+: make it later$/.test((sent[0] || {}).text || ''), (sent[0] || {}).text);
  ok('and the answer comes back here, not offscreen', (await page.locator('.dock .dsay').count()) === 1);
  ok('with a way through to the whole conversation', (await page.locator('.dock .dfull').count()) === 1);
  ok('the trip never left the screen', await page.locator('.phone iframe').isVisible());

  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/ask.png' });
  await ctx.close();
}


// --- telling it you have booked something, from the list itself -------------
//
// raffy, 2026-09-01: "the only way is for user to confirm via chat, so user
// need to navigate back to chat on different page (in mobile ) and have to keep
// referring to the still to do section right."
//
// The loop was: read the row, leave for the chat, lose the row, describe it
// from memory, come back to check. The row is where you say so now.
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const sent2 = [];
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_B' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: REAL, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  await ctx.route('**/api/send', (r) => { sent2.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ json: { ok: true } }); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_B'));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  const frame = page.frameLocator('iframe[title="Itinerary preview"]');
  await frame.locator('#nav button[data-view="book"]').click();
  await page.waitForTimeout(500);

  console.log('');
  const done = frame.locator('.tddone');
  ok('every outstanding row can be ticked off', (await done.count()) > 0, (await done.count()) + ' rows');
  ok('and it says what it does', (await done.first().innerText()).trim() === 'Done it');

  await done.first().click();
  await page.waitForTimeout(400);
  ok('it opens over the list, not in another page', (await page.locator('.dock').count()) === 1);
  ok('the trip is still on screen', await page.locator('.phone iframe').isVisible());
  // The label is an instruction until it is done, at which point its verb is
  // in the way: "Booked: Book the flights" reads like a stutter.
  const bl = await page.locator('.dock .dwhat b').innerText();
  ok('and it names what you booked', /^Booked: /.test(bl), bl);
  ok('without stuttering the verb', !/^Booked: (Book|Confirm) /i.test(bl), bl);
  ok('asking for the reference, not requiring it',
     /reference|confirmation/i.test(await page.locator('.dock textarea').getAttribute('placeholder')));

  // "I have booked it" is already a complete instruction, so an empty send is
  // allowed here — unlike "change this", which is a question with no question.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok('sending with nothing typed still works', sent2.length === 1, JSON.stringify(sent2.map((x) => x.text)));
  ok('and asks for both halves of the job',
     /booked this/i.test((sent2[0] || {}).text || '') && /tick it off/i.test((sent2[0] || {}).text || ''),
     (sent2[0] || {}).text);
  ok('naming the thing, not the instruction',
     !/booked this: (Book|Confirm) /i.test((sent2[0] || {}).text || ''), (sent2[0] || {}).text);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

// --- the list is theirs too: adding and removing their own rows -------------
//
// raffy, 2026-09-02: "we should let user to add and and delete their own to do
// . like some other things like enable roaming or buy e sim" — and then, of the
// button that was supposed to do it: "i cant click the add something on my
// own". It was emitted from inside a branch that a rewrite had left unreachable,
// and the listener behind it had been deleted twice by rewrites of the same
// block. Both are load-bearing enough to assert.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const sent3 = [];
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_C' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: REAL, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  await ctx.route('**/api/send', (r) => { sent3.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ json: { ok: true } }); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_C'));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  // On a phone the trip is a sheet over the chat, so it has to be opened
  // before anything in it can be tapped.
  await page.locator('.itbtn').click();
  await page.waitForTimeout(600);

  const frame = page.frameLocator('iframe[title="Itinerary preview"]');
  await frame.locator('#nav button[data-view="book"]').click();
  await page.waitForTimeout(500);

  console.log('');
  const add = frame.locator('.tdadd');
  ok('the list can be added to', (await add.count()) === 1);
  ok('and it is on screen, not clipped by the nav', await add.isVisible());
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/todo-mobile.png', fullPage: false });

  await add.click();
  await page.waitForTimeout(400);
  ok('tapping it opens the composer', (await page.locator('.dock').count()) === 1);
  ok('and says what it is for', /add to your list/i.test(await page.locator('.dock .dwhat').innerText()));
  ok('with examples of the kind of thing', /esim|insurance|passport/i.test(await page.locator('.dock textarea').getAttribute('placeholder')));

  // An empty add is not an add.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('an empty one cannot be sent', sent3.length === 0);

  await page.locator('.dock textarea').fill('buy an esim before we fly');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok('typing one sends it', sent3.length === 1, JSON.stringify(sent3.map((x) => x.text)));
  ok('as an instruction the agent can act on',
     /^Add this to my to-do list: buy an esim before we fly$/.test((sent3[0] || {}).text || ''), (sent3[0] || {}).text);

  await page.locator('.dock .dx').click();
  await page.waitForTimeout(300);
  const x = frame.locator('.tdx');
  ok('every row can be taken off the list', (await x.count()) > 0, (await x.count()) + ' rows');
  await x.first().click();
  await page.waitForTimeout(400);
  ok('and removing one asks before it goes', /^Remove: /.test(await page.locator('.dock .dwhat b').innerText()));

  // raffy, 2026-09-02: "place the x on the own list to the end right . just
  // like sorted section." A card with a link got it there for free — .tdgo is
  // flex:1 and eats the slack — but an errand has no link, so nothing pushed
  // and the remove sat tucked against Done it.
  await page.locator('.dock .dx').click();
  await page.waitForTimeout(300);
  const rows = await frame.locator('.tdcard .tdfoot').evaluateAll((els) => els.map((f) => {
    const x = f.querySelector('.tdx');
    if (!x) return null;
    return Math.round(f.getBoundingClientRect().right - x.getBoundingClientRect().right);
  }).filter((v) => v !== null));
  ok('every remove sits at the right edge of its card', rows.length > 0 && rows.every((g) => g < 3),
     rows.join(', ') + ' px from the edge');

  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
