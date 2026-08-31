import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const B = process.env.BASE || 'http://localhost:3211';

// Run against a PRODUCTION build (next build && next start). Under `next dev`
// the page does not re-hydrate after location.reload() — an HMR artifact, but
// it makes every reload assertion here fail for the wrong reason.
//
// A real itinerary, so the preview renders the way it will for a traveller.
// A hand-made stub is missing fields the renderer needs and fails for reasons
// that have nothing to do with what is being tested.
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// Never let it mint a real session — that is a live API call and costs money.
await page.route('**/api/session', (r) =>
  r.fulfill({ json: { session: 'sesn_NEWLYMINTED' } }));
await page.route('**/api/state**', (r) => {
  const id = new URL(r.request().url()).searchParams.get('session');
  const built = id === 'sesn_OLD';
  r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi, singapore and JB with the kids', id: 'u1' }],
    itinerary: built ? { ...REAL, trip: { ...REAL.trip, title: 'Singapore & Johor Bahru' } } : null,
    agentEdits: [], building: false, thinking: false, turns: 1,
  } });
});

// Seed the browser the way a returning traveller's would look.
// Seed ONCE. addInitScript runs on every navigation, so seeding
// unconditionally would quietly undo each reload and make a broken switch look
// like a working one.
await page.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  localStorage.setItem('seeded', '1');
  localStorage.setItem('itin.session.v1', 'sesn_OLD');
  localStorage.setItem('itin.trips.v1', JSON.stringify([
    { id: 'sesn_OLD', label: 'Singapore & Johor Bahru', at: Date.now() - 86400000 },
    { id: 'sesn_OLDER', label: 'Da Nang', at: Date.now() - 3 * 86400000 },
  ]));
});

await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

ok('My trips button shows', await page.locator('button:has-text("My trips")').count() === 1);
await page.locator('button:has-text("My trips")').click();
await page.waitForTimeout(250);
ok('menu lists both trips', await page.locator('.menu .trip').count() === 2);
ok('current trip marked open now', (await page.locator('.menu .trip.on .when').innerText()).includes('open now'));
await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/trips-menu.png' });

// Switching writes the id and reloads.
await page.locator('.menu .trip:not(.on) .pick').click();
await page.waitForTimeout(1200);
ok('switching sets the session', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_OLDER');

// New trip must not destroy history.
await page.evaluate(() => localStorage.setItem('itin.session.v1', 'sesn_OLD'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
ok('New trip button shows once built', await page.locator('button:has-text("New trip")').count() === 1);
await page.locator('button:has-text("New trip")').click();
await page.waitForTimeout(1500);
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]'));
ok('old trips survive New trip', kept.some((t) => t.id === 'sesn_OLD') && kept.some((t) => t.id === 'sesn_OLDER'),
   kept.map((t) => t.label).join(' | '));
ok('a fresh session was minted', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_NEWLYMINTED');

// ?s= opens one specific trip and cleans the URL.
await page.goto(B + '/?s=sesn_OLD', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
ok('?s= opens that session', await page.evaluate(() => localStorage.getItem('itin.session.v1')) === 'sesn_OLD');
ok('?s= stripped from the URL', !page.url().includes('s=sesn_OLD'), page.url());
ok('the trip is showing', (await page.locator('body').innerText()).includes('Singapore'));

// Nothing may overflow at phone width.
const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('no horizontal overflow at 390px', over <= 0, 'overflow ' + over + 'px');
ok('no page errors', errs.length === 0, errs.join(' / '));

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
