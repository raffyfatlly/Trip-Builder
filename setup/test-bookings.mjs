// The To do tab: the arranging phase.
//
// raffy, 2026-09-01: "im not happy with the booking tab .feels superficial
// especially like its an app."
//
// The first version drew the same stays the Trip tab draws, with a badge on
// them. It held nothing you could not already see. What makes a wallet a
// wallet is holding the actual confirmation — the reference you read out at a
// counter — so these tests are about records, not about the plan.
//
// Also guarded, from the first build of this tab: it must land as a SIBLING of
// the other views. The original marker swallowed the </section> that closes the
// day view, so Bookings nested inside Days, inherited [hidden], and rendered at
// zero height while cheerfully reporting display:block.
//
//   node setup/test-bookings.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

const STAYS = [
  // draft:true is what an unbooked stay looks like. Its absence means booked —
  // that is how the whole app reads it — so a stay without it is already sorted
  // and has no business on a to-do list.
  { ...REAL.stays[0], draft: true },
  { ...REAL.stays[0], n: 'La Siesta Hoi An', short: 'La Siesta', dates: '12 to 14 Sep', nights: '2 nights', draft: true },
];

// Served from a real origin: setContent leaves the document at about:blank,
// where the clipboard API is not available and relative URLs have no base.
const ORIGIN = 'https://itinerary.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch();

async function open(T, perms) {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true,
    permissions: perms || [],
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('#nav button[data-view="book"]').click();
  await page.waitForTimeout(300);
  return { ctx, page, errs, text: () => page.locator('#bookings').innerText() };
}

// --- a wallet with things in it ---------------------------------------------
{
  const T = {
    ...REAL,
    stays: STAYS,
    trip: { ...REAL.trip, flights: [{ from: 'KUL', to: 'DAD', code: 'AK1494', date: '10 Sep', dep: '06:40' }] },
    bookings: [
      { id: 'bk1', at: 1, kind: 'flight', title: 'AirAsia AK1494, KUL to DAD', ref: 'QK7T2P',
        when: '10 Sep, 06:40', where: 'KLIA2', note: 'Check-in opens 48h before. 20kg each.' },
      { id: 'bk2', at: 2, kind: 'stay', title: 'La Siesta Hoi An', ref: 'HB-99231',
        when: '12 to 14 Sep', stay: 1, who: 'Raffy Fatlly',
        details: [
          { k: 'Room', v: 'Deluxe Balcony, king bed' },
          { k: 'Board', v: 'Breakfast included' },
          { k: 'Total', v: 'VND 4,120,000 paid' },
          { k: 'Free cancellation until', v: '9 Sep' },
        ],
        doc: { url: '/api/doc?s=sesn_A&d=aaaabbbbccccddddeeeeffff', name: 'The confirmation' } },
    ],
    // Something they put on the list themselves, which is not a booking and
    // must not be offered a Book it button.
    tasks: [
      { id: 'tk9', what: 'Call my mum before we fly', kind: 'other' },
    ],
  };
  const { ctx, page, errs, text } = await open(T, ['clipboard-read', 'clipboard-write']);
  const t = await text();

  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('the nav has four tabs', await page.locator('#nav button').count() === 4);
  // raffy, 2026-09-01: "first todo, then explore, them day, last is trip" —
  // left to right, the order things actually happen.
  // raffy, 2026-09-01: "should we make it cleaner... so content of our app gets
  // clearer." The island stays; the translucency goes. Text sliding behind a
  // 93%-opaque blur came out HALF legible, which reads as a rendering fault
  // rather than as a layer, and a gradient scrim cannot fix it either — on the
  // dark trip card a fade tuned to the page background is a light smear.
  const navStyle = await page.locator('#nav').evaluate((n) => {
    const s = getComputedStyle(n);
    return { bg: s.backgroundColor, blur: s.backdropFilter };
  });
  ok('the bar hides what passes behind it', !/rgba\(/.test(navStyle.bg), navStyle.bg);
  ok('with no blur left to half-show it', navStyle.blur === 'none', navStyle.blur);
  ok('and the page ends clear of it',
     parseInt(await page.locator('.view').first().evaluate((v) => getComputedStyle(v).paddingBottom), 10) >= 130);

  // raffy, 2026-09-03: "do the trip view first, swap place with to do. to do
  // last." Trip is the front page again; To do is the drawer of admin.
  ok('in the order the trip happens',
     (await page.locator('#nav button').evaluateAll((b) => b.map((x) => x.getAttribute('data-view')))).join(',')
       === 'trip,map,days,book');
  // raffy, 2026-09-01: "change wallet to like to do or list or something." A
// wallet is a container; the tab is named after the job now.
  ok('the tab is named after the job', (await page.locator('#nav button[data-view="book"]').innerText()).trim() === 'To do');
  ok('it is its own view, not nested', await page.locator('#v-book').isVisible());
  ok('and it has real height', (await page.locator('#v-book').boundingBox()).height > 300);

  // The whole point: the record, not the plan.
  ok('a filed booking is the content', t.includes('AirAsia AK1494'));
  ok('its reference is on the card', t.includes('QK7T2P'));
  ok('the one thing worth remembering is kept', t.includes('Check-in opens 48h'));
  // What has to happen leads; what is done follows it.
  ok('what is left comes before what is done', t.indexOf('Sorted') > 40, t.slice(0, 60).replace(/\n/g, ' '));
  // Grouped by when, because that is what decides what you do next.
  ok('grouped by when it has to happen', /this week|still to do|after that/i.test(t), t.split('\n').slice(0, 8).join(' / '));
  // raffy, 2026-09-02: "for user own to do list , change 'after that' to
  // something like your to do . and i think for their own to do they don't
  // need that book link . cause it can be as random as call my mum."
  ok('what they added themselves is its own list', /your own list/i.test(t), t.replace(/\n/g, ' ').slice(0, 200));
  ok('and an errand on it is not offered a Book it button',
     (await page.locator('#bookings .tdcard', { hasText: 'Call my mum' }).locator('.tdgo').count()) === 0);
  ok('and it says To do, not To book',
     /to do/i.test(await page.locator('#bookings .tdcard', { hasText: 'Call my mum' }).locator('.bktag').innerText()));
  ok('and it does not explain its own sorting', !/not by what it is|order it has to happen/i.test(t));

  // The traveller told us this flight once and filed it once. Twice is a bug.
  const codes = (t.match(/AK1494/g) || []).length;
  ok('the flight is not listed twice', codes === 1, codes + ' mentions');

  // A booking that names a stay takes it off the outstanding list.
  const under = t.slice(0, t.indexOf('Sorted') > 0 ? t.indexOf('Sorted') : t.length);
  ok('the filed stay is off the to-do list', !under.includes('La Siesta'));
  ok('the unfiled stay is still on it', under.includes('Furama'));
  // A task says WHEN, because the deadline is the whole reason for the order.
  ok('every task carries a deadline', /week|now|today|by \d/i.test(under), under.slice(0, 120).replace(/\n/g, ' '));
  // And the link that finishes it.
  ok('and the link that does it', (await page.locator('#bookings .tdgo').count()) > 0);

  // raffy, 2026-09-02: "if the booking contains like room type etc will it be
  // displayed too on the confirmed cards ? or can we also put the link or
  // button to open the file too?"
  //
  // It carried the reference and threw the rest away, which makes the card a
  // bookmark rather than the booking. Everything the confirmation said is on
  // it now, and the confirmation itself is one tap from it.
  ok('a confirmation puts its specifics on the card',
     /Deluxe Balcony/.test(t) && /Breakfast included/.test(t), t.replace(/\n/g, ' ').slice(0, 160));
  ok('labelled, so it reads as a record', (await page.locator('#bookings .tddl dt').count()) >= 4);
  ok('including who it is under', /Raffy Fatlly/.test(t));
  ok('and the confirmation itself opens from the card',
     (await page.locator('#bookings a.tdgo[href*="/api/doc"]').count()) === 1);
  ok('saying what it opens',
     /the confirmation/i.test(await page.locator('#bookings a.tdgo[href*="/api/doc"]').innerText()));
  ok('it counts what is sorted', /\d of \d sorted/.test(t), t.split('\n')[0]);

  // Copying is what you actually do with a reference at a counter.
  const refBtn = page.locator('.bkref').first();
  await refBtn.scrollIntoViewIfNeeded();
  await refBtn.click();
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('tapping the reference copies it', clip === 'QK7T2P', JSON.stringify(clip));
  ok('and it says it did', /copied/i.test(await page.locator('.bkref').first().innerText()));

  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/bookings.png' });
  await ctx.close();
}

// --- an empty wallet ---------------------------------------------------------
{
  const T = { ...REAL, stays: STAYS };
  const { ctx, errs, text } = await open(T);
  const t = await text();
  ok('empty: no page errors', errs.length === 0, errs.join(' / '));
  ok('empty: it asks for a confirmation', t.includes('Nothing filed yet'));
  ok('empty: it says how to send one', /confirmation/i.test(t));
  ok('empty: both stays are still to do', t.includes('La Siesta') && t.includes('Furama'));
  ok('empty: nothing is sorted yet', /0 of \d sorted/.test(t), t.split('\n')[0]);
  await ctx.close();
}


// --- the trip page stops repeating the to-do list ---------------------------
//
// raffy, 2026-09-01: "for the before you lock this in , inside trip section, do
// u think that's the best position to place it there ?"
//
// It was a review screen for a review that no longer happens here — accepting
// the trip moved into the chat long ago. What was left was two things: notes
// about unbooked stays, which are tasks and belong on To do with a deadline and
// a link, and notes worth knowing, which are context. The first now goes.
{
  const T = {
    ...REAL,
    stays: STAYS,
    trip: { ...REAL.trip, notes: [
      { kind: 'warn', h: 'Stay 2 is not booked.', p: 'Everything after Friday assumes it.', stay: 1 },
      { kind: 'info', h: 'Mid-autumn festival falls in your week.', p: 'Hoi An fills up and the lanterns are the point.' },
    ] },
  };
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  // The app no longer lands on Trip — it opens on whatever the phase calls for.
  await page.locator('#nav button[data-view="trip"]').click();
  await page.waitForTimeout(300);
  const foot = await page.locator('#foot').innerText().catch(() => '');

  console.log('');
  ok('notes: no page errors', errs.length === 0, errs.join(' / '));
  ok('the review heading is gone', !/lock this in/i.test(foot), foot.split('\n')[0]);
  ok('what is left is context, not a checklist', /worth knowing/i.test(foot), foot.split('\n')[0]);
  // raffy, 2026-09-01: "the worth knowing part , should be in collapsed mode so
  // it doesn't take too much space of the trip page."
  ok('and it is folded away', (await page.locator('#foot details.wk').count()) === 1);
  ok('closed to start', !(await page.locator('#foot details.wk').evaluate((d) => d.open)));
  ok('saying how much is in it', /^1$/.test((await page.locator('#foot .wkn').innerText()).trim()));
  await page.locator('#foot .wk > summary').scrollIntoViewIfNeeded();
  await page.locator('#foot .wk > summary').click();
  await page.waitForTimeout(250);
  ok('and it opens', await page.locator('#foot details.wk').evaluate((d) => d.open));
  ok('with the note inside', /mid-autumn/i.test(await page.locator('#foot .wkb').innerText()));
  ok('an unbooked stay is not repeated here', !/not booked/i.test(foot), foot);
  // Checked against the OPENED body: a closed <details> keeps its contents out
  // of innerText, which is the point of folding it.
  const inside = await page.locator('#foot .wkb').innerText();
  ok('but something worth knowing stays', /mid-autumn/i.test(inside), inside.slice(0, 60));
  ok('and the unbooked stay is not in there either', !/not booked/i.test(inside));
  // And the booking it stopped repeating is on the list that owns it.
  await page.locator('#nav button[data-view="book"]').click();
  await page.waitForTimeout(300);
  ok('because To do owns it, with a deadline',
     /La Siesta/.test(await page.locator('#bookings').innerText()));
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
