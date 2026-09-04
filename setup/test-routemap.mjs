// The map, at every scale a trip can have.
//
// raffy, 2026-09-01: "would it be too hard to do the map like in phu quoc ? i
// really wish they have that map too like mine. it look nice." Then, catching
// the hard part himself: "but the map will cover their destination journey. u
// know what i mean? lke what if they go to two countries."
//
// The Phu Quoc map is hand-drawn and describes one island at one zoom. This
// one computes its zoom from the stays, so the same component has to survive
// one hotel, one city, and Kuala Lumpur to Hanoi. That is what is checked here.
//
//   node setup/test-routemap.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const stay = (n, lat, lon) => ({ ...REAL.stays[0], n, short: n, lat, lon });

const TRIPS = {
  'one city': [stay('Furama', 16.0296, 108.2497)],
  'two cities': [stay('Furama', 16.0296, 108.2497), stay('Hoi An', 15.8801, 108.3380)],
  'two countries': [
    stay('Kuala Lumpur', 3.1390, 101.6869),
    stay('Bangkok', 13.7563, 100.5018),
    stay('Hanoi', 21.0278, 105.8342),
  ],
  'two continents': [stay('Kuala Lumpur', 3.1390, 101.6869), stay('Rome', 41.9028, 12.4964)],
};


// Served from a real origin, not setContent. The map is requested as a
// relative /api/map, and a document at about:blank has no base to resolve it
// against — every image would fail for a reason the app will never hit.
const ORIGIN = 'https://itinerary.test';
const serve = async (ctx, html) => {
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
};

const browser = await chromium.launch();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

for (const [label, stays] of Object.entries(TRIPS)) {
  const { html } = render({ ...REAL, stays }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const asked = [];
  await page.route('**/api/map**', (r) => {
    asked.push(r.request().url());
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);

  // g.pin is a stay; g.pin.plan is a place in the daily plan; g.spot is an
  // idea. Counting every g caught the arrows and their container too.
  const pins = await page.locator('#routemap svg.pins g.pin:not(.plan)').count();
  const tiles = await page.locator('#routemap img.ground').count();
  const box = await page.locator('#routemap .rmap').boundingBox();
  // Every pin has to land inside the picture, which is the thing that breaks
  // when the zoom is wrong.
  const inside = await page.evaluate(() => {
    const svg = document.querySelector('#routemap svg.pins');
    if (!svg) return null;
    const vb = svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll('g.pin,g.spot')).every((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      if (!m) return false;
      const x = +m[1], y = +m[2];
      return x > 8 && y > 8 && x < vb.width - 8 && y < vb.height - 8;
    });
  });
  const url = asked.find((u) => u.includes('/api/map')) || '';
  const zoom = (/[?&]z=(\d+)/.exec(url) || [])[1];

  console.log('\n  — ' + label + ' (' + stays.length + ' stays, zoom ' + zoom + ')');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  ok('a styled map is requested from our own endpoint', !!url);
  ok('and the Google key is not in the page', !url.includes('key=') && !html.includes('AIza'));
  ok('exactly one ground image', tiles === 1);
  ok('one pin per stay', pins === stays.length, pins + ' pins');
  ok('every pin is inside the frame', inside === true);
  ok('the map has real size', !!box && box.width > 200 && box.height > 100,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'none');
  if (stays.length > 1) {
    // raffy, 2026-09-01: "remove tap a stop and in order from map." Both were
    // labelling what the picture already says, in the corners of the only
    // thing on the card worth looking at.
    ok('nothing floats over the map',
       (await page.locator('.rmap .rcap, .rmap .hint').count()) === 0);
    // The numbered list moved off the map and into the drawer, where it is
    // the list of places rather than a key.
    ok('the stays are listed in the drawer',
       (await page.locator('#rsheet #ordered .stop, #rsheet #ordered > *').count()) >= stays.length);
  }
  await page.screenshot({ path: 'shots/routemap-' + label.replace(/ /g, '-') + '.png' });
  await ctx.close();
}

// Zoom has to actually respond to the spread, or it is not solving anything.
const zoomOf = async (stays) => {
  const { html } = render({ ...REAL, stays }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  let z = null;
  await page.route('**/api/map**', (r) => {
    z = (/[?&]z=(\d+)/.exec(r.request().url()) || [])[1];
    r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);
  await ctx.close();
  return +z;
};
const near = await zoomOf(TRIPS['two cities']);
const far = await zoomOf(TRIPS['two continents']);
console.log('');
ok('a wider trip zooms out further', far < near, 'two cities z' + near + ' vs two continents z' + far);

// The tile failing is the common case in the wild — a slow network, a blocked
// host, an offline phone. It must not take the map down with it: that looked
// exactly like the feature had never shipped, and cost an evening of hunting
// for a deploy problem that did not exist.
{
  const { html } = render({ ...REAL, stays: TRIPS['two cities'] }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/api/map**', (r) => r.abort());
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);
  const box = await page.locator('#routemap .rmap').boundingBox();
  console.log('');
  ok('a dead map does not collapse the card', !!box && box.height > 120,
     box ? Math.round(box.width) + '×' + Math.round(box.height) : 'zero height');
  ok('the pins survive it', (await page.locator('#routemap svg.pins g.pin').count()) === 2);
}

// A stay with a photo shows the photo, the way the Phu Quoc map does.
//
// raffy, 2026-09-01: "also possible to make map closer to how my phu quoc look?
// like the no 1 and 2 is the image of the hotel .if possible."
{
  const withPics = {
    ...REAL,
    photos: { h1: 'https://pics.test/1.jpg', h2: 'https://pics.test/2.jpg' },
    // One with a photo, one without: the second must keep the plain marker
    // rather than showing a grey hole where a picture should be.
    stays: [
      { ...stay('Furama', 16.0296, 108.2497), photo: 'h1' },
      { ...stay('Hoi An', 15.8801, 108.3380) },
    ],
  };
  const { html } = render(withPics, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('https://pics.test/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);

  console.log('');
  ok('a stay with a photo is drawn as the photo',
     (await page.locator('#routemap svg.pins image').count()) === 1);
  ok('and it is the stay photo, not a map tile',
     (await page.locator('#routemap svg.pins image').getAttribute('href')) === 'https://pics.test/1.jpg');
  ok('it is round, not a square stuck on the map',
     (await page.locator('#routemap svg clipPath circle').count()) === 1);
  ok('a stay with no photo keeps its marker',
     (await page.locator('#routemap svg.pins g.pin').count()) === 2);
  ok('both are still tappable', (await page.locator('#routemap svg.pins g.pin[role=button]').count()) === 2);
  // The frame has to make room for them, or the first stay sits half outside it.
  const inside2 = await page.evaluate(() => {
    const svg = document.querySelector('#routemap svg.pins');
    const vb = svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll('g.pin')).every((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      const x = +m[1], y = +m[2];
      return x > 40 && y > 40 && x < vb.width - 40 && y < vb.height - 40;
    });
  });
  ok('and keeps them clear of the edges', inside2 === true);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/routemap-photos.png' });
  await ctx.close();
}

// --- how the route is drawn -------------------------------------------------
//
// raffy, 2026-09-01: "draw like dash line rather than solid in between... then
// i dont want straight line do it like in my phu quoc map. also i want some
// line from the map with like flight or car icon to the airport."
{
  const two = [stay('Furama', 16.0296, 108.2497), stay('Hoi An', 15.8801, 108.3380)];
  const open = async (trip) => {
    const { html } = render(trip, tpl);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
    await serve(ctx, html);
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.locator('#nav button[data-view="map"]').click();
    await page.waitForTimeout(400);
    return { ctx, page };
  };

  console.log('');
  {
    const { ctx, page } = await open({ ...REAL, stays: two });
    const paths = await page.locator('#routemap svg.pins path').evaluateAll(
      (els) => els.map((e) => ({ d: e.getAttribute('d'), dash: e.getAttribute('stroke-dasharray') })));
    const route = paths.filter((p) => p.d && /^M[\d.]+ [\d.]+ [QC]/.test(p.d));
    ok('two stays are joined by a curve, not a ruler', route.length > 0,
       (paths[0] || {}).d);
    // Scoped to the route itself. The arrowheads along it are triangles drawn
    // with L, which is the one straight line on this map that should be there.
    const strokes = await page.locator('#routemap svg.pins > path').evaluateAll(
      (els) => els.map((e) => e.getAttribute('d')));
    ok('and nothing is drawn as a straight segment',
       !strokes.some((d) => d && / L[\d.-]/.test(d)), JSON.stringify(strokes));
    ok('the route is dashed', paths.some((p) => p.dash), JSON.stringify(paths.map((p) => p.dash)));
    // Long dashes, not dots: dots read as a hint and vanish over dense streets.
    const dash = (paths.find((p) => p.dash) || {}).dash || '';
    ok('with dashes rather than dots', parseFloat(dash) >= 6, dash);
    await ctx.close();
  }

  // The airport is drawn from real coordinates or not at all — a plane marker
  // at a made-up position on a REAL map is a lie.
  {
    const { ctx, page } = await open({ ...REAL, stays: two,
      trip: { ...REAL.trip, flights: [{ dir: 'out', from: 'KUL', to: 'DAD', lat: 16.0439, lon: 108.1994 }] } });
    ok('a known airport is on the map', (await page.locator('#routemap .airpin').count()) === 1);
    ok('and says which one',
       /DAD/.test(await page.locator('#routemap .airpin').evaluate((g) => g.textContent)));
    ok('with no incoming leg when we do not know where from',
       !/from /.test(await page.locator('#routemap .airpin').evaluate((g) => g.textContent)));
    await ctx.close();
  }

  // The leg in from the origin, pointed along the true bearing. raffy:
  // "there will be like a dash line coming from origin direction to the
  // airport , and airport to first hotel right ?"
  {
    const { ctx, page } = await open({ ...REAL, stays: two,
      trip: { ...REAL.trip, flights: [{ dir: 'out', from: 'KUL', to: 'DAD',
        lat: 16.0439, lon: 108.1994, fromLat: 2.7456, fromLon: 101.7099 }] } });
    const g = await page.locator('#routemap svg.pins').evaluate((el) => el.innerHTML);
    ok('a known origin draws a leg in', /from KUL/.test(g));
    // KL is south-west of Da Nang, so the stub must leave the airport to the
    // lower left. A decoration would not know that.
    const seg = /M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)/.exec(g);
    ok('pointed the way they actually fly in',
       !!seg && +seg[1] < +seg[3] && +seg[2] > +seg[4],
       seg ? seg[0] : 'no leg');
    // raffy: "must go all the way to end of map". A line stopping in open
    // country reads as a route to nowhere; one leaving the frame reads as
    // coming from somewhere off it, which is the truth.
    const vb = await page.locator('#routemap svg.pins').evaluate((el) => ({
      w: el.viewBox.baseVal.width, h: el.viewBox.baseVal.height }));
    const onEdge = seg && (+seg[1] <= 0.5 || +seg[2] <= 0.5
      || +seg[1] >= vb.w - 0.5 || +seg[2] >= vb.h - 0.5);
    ok('and it runs off the edge of the map', !!onEdge,
       seg ? seg[1] + ',' + seg[2] + ' in ' + vb.w + '×' + vb.h : 'no leg');
    await ctx.close();
  }

  // Only a trip somebody flies to has an airport on its map.
  {
    const { ctx, page } = await open({ ...REAL, stays: two,
      trip: { ...REAL.trip, arriveBy: 'drive',
        flights: [{ dir: 'out', from: 'KUL', to: 'DAD', lat: 16.0439, lon: 108.1994 }] } });
    ok('a driven trip has no airport', (await page.locator('#routemap .airpin').count()) === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ ...REAL, stays: two,
      trip: { ...REAL.trip, flights: [{ dir: 'out', from: 'KUL', to: 'DAD' }] } });
    ok('no coordinates means no airport', (await page.locator('#routemap .airpin').count()) === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ ...REAL, stays: two,
      trip: { ...REAL.trip, flights: [{ dir: 'out', from: 'KUL', to: 'DAD', lat: 51.47, lon: -0.45 }] } });
    ok('and a hallucinated one is dropped, not drawn',
       (await page.locator('#routemap .airpin').count()) === 0);
    await ctx.close();
  }
}

// Tapping a stop opens that stay.
{
  const { html } = render({ ...REAL, stays: TRIPS['two cities'] }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);
  ok('pins are marked up as buttons',
     (await page.locator('#routemap svg.pins g.pin[role="button"]').count()) === 2);
  await page.locator('#routemap svg.pins g.pin').nth(1).click();
  await page.waitForTimeout(500);
  const sheet = await page.locator('#sheet').innerText();
  ok('tapping the second pin opens the second stay', /Hoi An/.test(sheet), sheet.split('\n')[0]);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/routemap-no-tile.png' });
  await ctx.close();
}


// --- three tiers, and the difference between them ---------------------------
//
// raffy, 2026-09-05: "i want all the everything we found , also included in
// nice way but not too prominent of course. the prominent one should be the
// hotels user stays and also the places that's already in the daily plan. i
// want all in there with different prominence in terms of design."
//
// A stay is loudest, a place in the plan is next, an idea nobody has committed
// to is a quiet ring. What is checked here is that all three are present, that
// they are told apart by more than size, and that the quiet one never gets to
// move the camera.
{
  console.log('');
  const dense = JSON.parse(JSON.stringify(REAL));
  dense.stays = [stay('Furama', 16.0296, 108.2497), stay('Hoi An', 15.8801, 108.3380)];
  dense.ideas = (dense.ideas || []).slice(0, 4).map((o, n) => ({
    ...o, lat: 16.04 + n * 0.012, lon: 108.235 + n * 0.011,
  }));
  // Far enough away to change the zoom if ideas were allowed to.
  dense.ideas.push({ ...dense.ideas[0], n: 'Somewhere in Laos', lat: 18.5, lon: 103.5 });
  let n = 0;
  dense.days = (dense.days || []).map((d) => ({ ...d, items: (d.items || []).map((x) => (
    n < 6 && /\s[A-Z]/.test(x.h || '') ? (n++, { ...x, lat: 16.05 + n * 0.014, lon: 108.21 + n * 0.013 }) : x
  )) }));

  const { html } = render(dense, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/photo**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(600);

  const stays = await page.locator('#routemap svg.pins g.pin:not(.plan)').count();
  const plan = await page.locator('#routemap svg.pins g.plan').count();
  const spots = await page.locator('#routemap svg.pins g.spot').count();
  ok('the stays are on the map', stays === 2, stays + ' stays');
  ok('so is the daily plan', plan > 0, plan + ' plan markers');
  ok('and so are the ideas nobody picked', spots > 0, spots + ' idea markers');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  // Prominence, in the only terms the page has: a stay is bigger and a
  // different colour, and an idea is hollow.
  const size = (sel) => page.locator(sel).first().evaluate(
    (g) => Math.max(...Array.from(g.querySelectorAll('circle,image'))
      .map((e) => +(e.getAttribute('r') || (+e.getAttribute('width') / 2) || 0))
      .filter((v) => v && v < 900)));
  const sStay = await size('#routemap svg.pins g.pin:not(.plan)');
  const sPlan = await size('#routemap svg.pins g.plan');
  const sSpot = await size('#routemap svg.pins g.spot');
  ok('a stay is drawn larger than a plan stop', sStay > sPlan, sStay + ' vs ' + sPlan);
  ok('and a plan stop larger than an idea', sPlan > sSpot, sPlan + ' vs ' + sSpot);
  ok('an idea is a ring, not a disc',
     await page.locator('#routemap svg.pins g.spot circle[stroke="#EE7B45"][fill="#FFFFFF"]').count() > 0);

  // Names appear as there is room for them, so what matters is not how many
  // there are but that no two of them sit on top of each other.
  const overlap = await page.evaluate(() => {
    const shown = Array.from(document.querySelectorAll('#routemap svg.pins text.mlab'))
      .filter((t) => t.style.display !== 'none' && t.closest('g').style.display !== 'none')
      .map((t) => { const r = t.getBoundingClientRect(); return { r, s: t.textContent }; });
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].r, b = shown[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        return shown[i].s + ' / ' + shown[j].s;
    }
    return '';
  });
  ok('no two names sit on top of each other', overlap === '', overlap);

  // An idea in another country must not pull the whole map out to fit it.
  const url = await page.locator('#routemap img.ground').getAttribute('src');
  const z = +(/[?&]z=(\d+)/.exec(url || '') || [])[1];
  ok('an idea far away does not drag the zoom out', z >= 9, 'zoom ' + z);

  // The journey reads as a journey.
  ok('arrows point the way along the route',
     (await page.locator('#routemap #rarrows g').count()) >= 2);

  // raffy, 2026-09-05: "englarge the map so it can take the whole screen on
  // mobile. i want user to have that immersive feeling."
  const box = await page.locator('#routemap .rmap').boundingBox();
  ok('the map fills the phone', box.width === 390 && box.height > 600,
     Math.round(box.width) + '×' + Math.round(box.height));
  ok('and takes the page heading with it',
     await page.locator('#exhead').count() === 0 ||
     await page.locator('#exhead').isHidden());
  ok('the page does not scroll sideways',
     await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth));

  // The tile is ordered to fit the box rather than cropped down to it.
  const w = +(/[?&]w=(\d+)/.exec(url || '') || [])[1];
  const vb = await page.locator('#routemap svg.pins').evaluate((s2) => s2.viewBox.baseVal.width);
  ok('the map tile is asked for in the shape it will be shown at',
     Math.abs(w / 640 - box.width / box.height) < 0.06, w + 'x640 for ' + Math.round(box.width) + '×' + Math.round(box.height));
  ok('and the pins are drawn in that same space', vb === w, vb + ' vs ' + w);

  await ctx.close();
}


// --- zooming ----------------------------------------------------------------
//
// raffy, 2026-09-05: "a good solution would be if user can zoom in or zoom out
// the map up to certain level right."
//
// Bounded on purpose. Below 1 the frame would show background instead of
// ground; above 3 a static tile served at scale=2 stops looking like a map.
// And the pan is clamped, because a map thrown off its own frame is a blank
// rectangle with no way back.
{
  console.log('');
  const { html } = render({ ...REAL, stays: TRIPS['two cities'] }, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);

  const scaleOf = () => page.locator('#routemap .rmapz').evaluate((el) => {
    const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(el).transform || '');
    return m ? +m[1] : 1;
  });
  const shift = () => page.locator('#routemap .rmapz').evaluate((el) => {
    const m = /matrix\(([-\d., ]+)\)/.exec(getComputedStyle(el).transform || '');
    const v = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    return { x: v[4], y: v[5] };
  });

  ok('it starts unzoomed', Math.abs(await scaleOf() - 1) < 0.01);
  ok('and cannot zoom out from there',
     await page.locator('#routemap [data-zoom="out"]').isDisabled());

  await page.locator('#routemap [data-zoom="in"]').click();
  await page.waitForTimeout(120);
  const z1 = await scaleOf();
  ok('the plus button zooms in', z1 > 1.3, 'scale ' + z1.toFixed(2));
  ok('and zooming out becomes possible',
     !(await page.locator('#routemap [data-zoom="out"]').isDisabled()));

  for (let i = 0; i < 6; i++) {
    if (await page.locator('#routemap [data-zoom="in"]').isDisabled()) break;
    await page.locator('#routemap [data-zoom="in"]').click();
    await page.waitForTimeout(60);
  }
  const top = await scaleOf();
  ok('it stops at a ceiling', top <= 2.61 && top > 2.0, 'scale ' + top.toFixed(2));
  ok('and says so by disabling the button',
     await page.locator('#routemap [data-zoom="in"]').isDisabled());

  // Zoomed all the way in and pushed hard: the ground must still fill the frame.
  const box = await page.locator('#routemap .rmap').boundingBox();
  await page.mouse.move(box.x + 60, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 460, { steps: 12 });
  await page.mouse.move(box.x + 380, box.y + 600, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const s2 = await shift();
  ok('a drag pans the map', s2.x !== 0 || s2.y !== 0,
     Math.round(s2.x) + ',' + Math.round(s2.y));
  ok('but never off its own frame', s2.x <= 0.5 && s2.y <= 0.5,
     Math.round(s2.x) + ',' + Math.round(s2.y));

  while (!(await page.locator('#routemap [data-zoom="out"]').isDisabled())) {
    await page.locator('#routemap [data-zoom="out"]').click();
    await page.waitForTimeout(60);
  }
  const back = await shift();
  ok('zooming back out returns it to the frame',
     Math.abs(await scaleOf() - 1) < 0.01 && Math.abs(back.x) < 1 && Math.abs(back.y) < 1,
     Math.round(back.x) + ',' + Math.round(back.y));

  // The whole point of the pins is that they open things. A pan layer that
  // swallows their taps is worse than no pan layer.
  await page.locator('#routemap svg.pins g.pin').nth(1).click();
  await page.waitForTimeout(400);
  ok('and a pin still opens its stay after all that',
     (await page.locator('#sheet[data-open="true"]').count()) === 1);

  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}


// --- the drawer -------------------------------------------------------------
//
// raffy, 2026-09-05: "there's a drawer at the bottom for all the contents of the
// places that we go to... it's got quite stuck because... I'm trying to scroll
// down, and then it blocks the scrolling down experience."
//
// So the tab is exactly one viewport tall and never scrolls; the drawer does.
// And the thing that breaks every hand-rolled drawer — pointer capture taken on
// the first press, which quietly redirects the click away from whatever was
// underneath — is checked here, because it has now bitten twice.
{
  console.log('');
  const rich = JSON.parse(JSON.stringify(REAL));
  rich.stays = TRIPS['two cities'];
  const { html } = render(rich, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await serve(ctx, html);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(500);

  const snap = () => page.locator('#rsheet').getAttribute('data-snap');
  const top = () => page.locator('#rsheet').evaluate((el) => el.getBoundingClientRect().top);

  ok('the page itself does not scroll',
     await page.evaluate(() => document.body.scrollHeight <= window.innerHeight + 1),
     await page.evaluate(() => document.body.scrollHeight + '/' + window.innerHeight));
  ok('the drawer opens peeking, so the map is what you see', await snap() === 'peek');

  const peekTop = await top();
  ok('and it leaves most of the screen to the map', peekTop > 600, Math.round(peekTop) + 'px down');
  ok('it says how many places there are',
     /\d+ places/.test(await page.locator('#rshead').innerText()),
     (await page.locator('#rshead').innerText()).replace(/\n/g, ' '));

  await page.locator('#rgrab').click();
  await page.waitForTimeout(500);
  ok('a tap on the handle opens it', await snap() === 'mid');
  const midTop = await top();
  ok('and it actually moved', midTop < peekTop - 100, Math.round(midTop) + ' vs ' + Math.round(peekTop));

  await page.locator('#rgrab').click();
  await page.waitForTimeout(500);
  ok('again and it opens fully', await snap() === 'full');
  ok('the map is still behind it, not unloaded',
     (await page.locator('#routemap img.ground').count()) === 1);

  // The list is real content and has to stay tappable through the drag layer.
  const card = page.locator('#rsheet #ordered .stop, #rsheet #ordered button, #rsheet #ordered [data-stay]').first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(400);
    ok('a card inside the drawer still opens', await page.locator('#sheet[data-open="true"]').count() === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Dragging down from the top of the list closes it; that is the gesture
  // everybody tries first.
  const b2 = await page.locator('#rsheet').boundingBox();
  await page.mouse.move(195, b2.y + 90);
  await page.mouse.down();
  await page.mouse.move(195, b2.y + 420, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok('dragging down from the list closes it', (await snap()) !== 'full', await snap());

  ok('and the page still does not scroll',
     await page.evaluate(() => document.body.scrollHeight <= window.innerHeight + 1));
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
