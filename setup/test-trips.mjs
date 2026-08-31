// Can a traveller get back to a trip they already built?
//
// Run against a PRODUCTION build (next build && next start). Under `next dev`
// the page does not re-hydrate after location.reload(), so every reload
// assertion here fails for a reason that has nothing to do with the product.
//
//   npx next build && npx next start -p 3211
//   node setup/test-trips.mjs
//
// No API cost: /api/session and /api/state are stubbed, so nothing reaches
// Anthropic and no session is ever really created.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const B = process.env.BASE || 'http://localhost:3211';

// A real itinerary, so the preview renders the way it will for a traveller. A
// hand-made stub is missing fields the renderer needs and fails for reasons
// that have nothing to do with what is being tested.
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

let fail = 0;
const ok = (n, c, x) => {
  console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : ''));
  if (!c) fail++;
};

const browser = await chromium.launch();
const errs = [];

// Each scenario gets its own context: localStorage is shared per origin, so
// scenarios sharing one would quietly overwrite each other's setup.
async function scenario(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // On the context, not one page — an extra page would otherwise bypass the
  // stub and hit the real API, which costs real money.
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_NEWLYMINTED' } }));
  await ctx.route('**/api/state**', (r) => {
    const id = new URL(r.request().url()).searchParams.get('session');
    const built = id === 'sesn_OLD';
    // A session nobody has typed into yet really is empty — and an empty one
    // must not enter the trip list, or "New trip" would immediately litter it.
    const blank = id === 'sesn_BLANK' || id === 'sesn_NEWLYMINTED';
    r.fulfill({ json: {
      transcript: blank ? [] : [{ role: 'user', text: 'hi, singapore and JB with the kids', id: 'u1' }],
      itinerary: built ? { ...REAL, trip: { ...REAL.trip, title: 'Singapore & Johor Bahru' } } : null,
      agentEdits: [], building: false, thinking: false, turns: 1,
    } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  // Seed ONCE. addInitScript runs on every navigation, so seeding
  // unconditionally would undo each reload and make a broken switch look like
  // a working one.
  await page.addInitScript((s) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    if (s.session) localStorage.setItem('itin.session.v1', s.session);
    localStorage.setItem('itin.trips.v1', JSON.stringify(s.trips));
  }, seed);
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const OLD = { id: 'sesn_OLD', label: 'Singapore & Johor Bahru', at: Date.now() - 86400000 };
const OLDER = { id: 'sesn_OLDER', label: 'Da Nang', at: Date.now() - 3 * 86400000 };

// --- the main case: two trips, one of them open ---------------------------
{
  const { ctx, page } = await scenario({ session: 'sesn_OLD', trips: [OLD, OLDER] });

  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  ok('the drawer opens', await page.locator('.drawer.on').count() === 1);
  ok('it lists both trips', await page.locator('.drawer .row').count() === 2);
  ok('current trip marked open now', (await page.locator('.drawer .row.on .when').innerText()).includes('Open now'));
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/trips-menu.png' });

  // Removing asks first now, so check the guard before using the switch below.
  await page.locator('.drawer .row:not(.on) .x').click();
  await page.waitForTimeout(300);
  ok('removing a trip asks first', await page.locator('.drawer .row.confirm').count() === 1);
  ok('and names the one it would remove',
     (await page.locator('.drawer .row.confirm .ask').innerText()).includes('Da Nang'));
  ok('and says what it does not do',
     (await page.locator('.drawer .row.confirm .ask').innerText()).toLowerCase().includes('not deleted'));
  const before = await page.locator('.drawer .row').count();
  await page.locator('.drawer .row.confirm .keep').click();
  await page.waitForTimeout(250);
  ok('backing out changes nothing',
     await page.locator('.drawer .row').count() === before && await page.locator('.drawer .row.confirm').count() === 0);

  await page.locator('.drawer .row:not(.on) .x').click();
  await page.waitForTimeout(250);
  await page.locator('.drawer .row.confirm .go').click();
  await page.waitForTimeout(350);
  ok('confirming removes it', await page.locator('.drawer .row').count() === before - 1);
  ok('and it stays gone',
     !(await page.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]').map((t) => t.id)))
       .includes('sesn_OLDER'));

  // Put it back for the switching check below.
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('itin.trips.v1') || '[]');
    l.push({ id: 'sesn_OLDER', label: 'Da Nang', at: Date.now() - 3 * 86400000 });
    localStorage.setItem('itin.trips.v1', JSON.stringify(l));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  await page.locator('.drawer .row:not(.on) .pick').click();
  await page.waitForTimeout(1200);
  ok('switching sets the session', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_OLDER');

  // New trip must not destroy history.
  await page.evaluate(() => localStorage.setItem('itin.session.v1', 'sesn_OLD'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  ok('New trip lives in the drawer', await page.locator('.drawer .act:has-text("New trip")').count() === 1);
  await page.locator('.drawer .act:has-text("New trip")').click();
  await page.waitForTimeout(1800);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]'));
  ok('old trips survive New trip', kept.some((t) => t.id === 'sesn_OLD') && kept.some((t) => t.id === 'sesn_OLDER'));
  ok('a fresh session was minted', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_NEWLYMINTED');

  // Straight after New trip, before anything is typed, the way back must be
  // on screen — this is the moment the menu exists for.
  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  ok('the trip you came from is still there', await page.locator('.drawer .row').count() >= 1);
  await page.locator('.drawer .close').click();
  await page.waitForTimeout(350);

  // Nothing may float over the conversation. The itinerary is reached from the
  // header; a button parked above the composer covered the last thing the
  // agent said, which is the part you are actually reading.
  ok('no floating button over the chat', await page.locator('.fab').count() === 0);

  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('no horizontal overflow at 390px', over <= 0, 'overflow ' + over + 'px');
  await ctx.close();
}

// --- one saved trip, blank session ----------------------------------------
// The regression that mattered: the menu was gated on a COUNT of trips, so
// with one saved trip and a blank session it vanished in precisely the case it
// exists for, leaving no way back at all.
{
  const { ctx, page } = await scenario({ session: 'sesn_BLANK', trips: [OLD] });
  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  ok('it offers the trip you came from', await page.locator('.drawer .row').count() === 1);
  ok('the blank session did not litter the list', !(await page.locator('.drawer .row.on').count()));
  await ctx.close();
}

// --- a first visit --------------------------------------------------------
// Nothing built, nothing remembered: the menu would be empty, so it is not there.
{
  const { ctx, page } = await scenario({ session: 'sesn_BLANK', trips: [] });
  await page.locator('.burger').click();
  await page.waitForTimeout(400);
  ok('no trip list on a first visit', await page.locator('.drawer .row').count() === 0);
  ok('but New trip is always reachable', await page.locator('.drawer .act:has-text("New trip")').count() === 1);
  ok('and no itinerary button in the header', await page.locator('header .itbtn').count() === 0);
  await ctx.close();
}

// --- the itinerary opens from the header ----------------------------------
{
  const { ctx, page } = await scenario({ session: 'sesn_OLD', trips: [OLD] });
  ok('Itinerary button in the header', await page.locator('header .itbtn').count() === 1);
  // Icon only, so it still has to say what it is to anything that cannot see it.
  ok('the icon still announces itself',
     (await page.locator('header .itbtn').getAttribute('aria-label')) === 'Itinerary');
  ok('and carries no label text', (await page.locator('header .itbtn').innerText()).trim() === '');
  const box = await page.locator('header .itbtn').boundingBox();
  ok('it sits at the top, not over the chat', box.y < 80, 'y=' + Math.round(box.y));
  await page.locator('header .itbtn').click();
  await page.waitForTimeout(700);
  ok('it opens the itinerary', await page.locator('.pane.open').count() === 1);
  // The preview itself lives in an iframe, so check the pane's own chrome and
  // then the document inside it.
  ok('the pane is titled with the trip',
     (await page.locator('.panehead').innerText()).includes('Singapore & Johor Bahru'));
  await page.waitForTimeout(600);
  ok('the preview rendered inside',
     (await page.frameLocator('.phone iframe').locator('body').innerText()).trim().length > 200);
  await ctx.close();
}

// --- ?s= recovery ---------------------------------------------------------
{
  const { ctx, page } = await scenario({ session: null, trips: [] });
  await page.goto(B + '/?s=sesn_OLD', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  ok('?s= opens that session', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_OLD');
  ok('?s= stripped from the URL', !page.url().includes('s=sesn_OLD'), page.url());
  ok('the trip is showing', (await page.locator('body').innerText()).includes('Singapore'));
  ok('and it is remembered from now on',
     (await page.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]'))).some((t) => t.id === 'sesn_OLD'));
  await ctx.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
