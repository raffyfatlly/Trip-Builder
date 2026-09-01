// No idea gets silently dropped.
//
// raffy, 2026-09-01: "the ideas nearby tab, has nothing under ideas nearby.
// maybe there we can put all the ideas to explore of the trip."
//
// The template renders ideas strictly inside AREAS.forEach, matching each idea
// to an area key. Phu Quoc has four hand-written areas so every idea found a
// home; a generated trip often has none — his Italy trip has two ideas and
// zero areas — and the loop then produced nothing at all. The agent's research
// rendered as an empty heading.
//
//   node setup/test-ideas.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const idea = (n, area, verdict, travel) =>
  ({ n, one: 'Worth the trip', time: '2 hours', icon: 'sun', verdict: verdict || 'yes', area, travel });

const ORIGIN = 'https://itinerary.test';
const browser = await chromium.launch();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const openIdeas = async (T) => {
  const { html } = render(T, tpl);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await ctx.route('**/api/map**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForTimeout(400);
  return { ctx, page, errs };
};

// The case that was broken: ideas, no areas.
{
  const T = { ...REAL, areas: [], ideas: [idea('Path of the Gods'), idea('Amalfi by ferry')] };
  const { ctx, page, errs } = await openIdeas(T);
  const cards = await page.locator('#ideas .ideacard').count();
  ok('ideas with no areas still render', cards === 2, cards + ' cards');
  ok('under an honest heading', (await page.locator('#ideas').innerText()).includes('Worth a look'));
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await page.screenshot({ path: 'shots/ideas-noareas.png' });
  await ctx.close();
}

// Grouping still works when the agent does supply areas.
{
  const T = {
    ...REAL,
    areas: [{ k: 'sorrento', t: 'Sorrento', sub: '10 min' }],
    ideas: [idea('Marina Grande', 'sorrento'), idea('Path of the Gods', 'sorrento')],
  };
  const { ctx, page, errs } = await openIdeas(T);
  ok('grouped ideas still group', (await page.locator('#ideas').innerText()).includes('Sorrento'));
  ok('and all of them show', (await page.locator('#ideas .ideacard').count()) === 2);
  ok('with no stray catch-all heading', !(await page.locator('#ideas').innerText()).includes('Worth a look'));
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

// The mixed case: some grouped, some orphaned by a typo'd area key.
{
  const T = {
    ...REAL,
    areas: [{ k: 'sorrento', t: 'Sorrento', sub: '10 min' }],
    ideas: [idea('Marina Grande', 'sorrento'), idea('Blue Grotto', 'capri'), idea('Amalfi by ferry')],
  };
  const { ctx, page, errs } = await openIdeas(T);
  const text = await page.locator('#ideas').innerText();
  ok('every idea appears, grouped or not', (await page.locator('#ideas .ideacard').count()) === 3);
  ok('the strays get their own heading', text.includes('More to explore'));
  ok('including one with an area that does not exist', text.includes('Blue Grotto'));
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

// Ranked by worth, not by radius.
//
// raffy, 2026-09-01: "im scared we only limit to certain radius... they missed
// opportunity that are worth it even if it far" and "i only want to give the
// best out of the best only as suggestions."
//
// Grouping everything by area silently ranks the list by distance — the temple
// two hours out gets filed under a heading nobody scrolls to, beneath a cafe
// down the road. The must-go handful leads instead, ungrouped.
{
  const T = {
    ...REAL,
    areas: [{ k: 'near', t: 'Near the hotel', sub: '10 min' }],
    ideas: [
      idea('Beach cafe', 'near'),
      idea('Besakih Temple', 'far', 'must', '2h drive each way'),
      idea('Sunrise on Batur', null, 'must', '3h, leaves at 2am'),
      idea('Corner warung', 'near', 'maybe'),
    ],
  };
  const { ctx, page, errs } = await openIdeas(T);
  const text = await page.locator('#ideas').innerText();
  const order = await page.locator('#ideas .ideacard .it').allInnerTexts();

  ok('the must-go section leads', text.indexOf('Don') < text.indexOf('Near the hotel'));
  ok('a far must-go outranks a near maybe',
     order.indexOf('Besakih Temple') < order.indexOf('Beach cafe'), order.join(' / '));
  ok('a must-go with no area is not lost', order.includes('Sunrise on Batur'));
  ok('the long drive is stated, not hidden', text.includes('2h drive each way'));
  ok('nothing is listed twice', new Set(order).size === order.length, order.join(' / '));
  ok('the near things still group by area', text.includes('Near the hotel'));
  ok('every idea appears exactly once', order.length === 4, order.length + ' cards');
  ok('no page errors', errs.length === 0, errs.join(' / '));
  // Every existing trip has ideas with no photo. aspect-ratio resolved to zero
  // on a flex item whose only child is absolutely positioned, so the picture
  // area — and the Don't-miss badge inside it — silently vanished.
  const pic = await page.locator('#ideas .ipic').first().boundingBox();
  ok('a photoless card keeps its picture area', !!pic && pic.height > 60,
     pic ? Math.round(pic.height) + 'px' : 'collapsed');
  // And a WIDTH, which is the half that was missing.
  //
  // raffy, 2026-09-01: "in worth a look ideas there are no photos." The card
  // switched from the template's centred grid row to a flex column without
  // resetting align-items, so every child shrank to its own content width — and
  // a picture area whose only content is a background has none. The photos were
  // not missing; there was nowhere to put one.
  ok('and it fills the card', !!pic && pic.width > 100,
     pic ? Math.round(pic.width) + '×' + Math.round(pic.height) : 'collapsed');
  ok('an idea with no photo still shows something',
     /gradient/.test(await page.locator('#ideas .ipic').first().evaluate((el) => getComputedStyle(el).backgroundImage)));
  const badge = await page.locator('#ideas .ivd').first().boundingBox();
  ok('so the badge is actually visible', !!badge && badge.height > 0);

  // raffy, 2026-09-01: "everything we found , explore , all need photo and
  // relevant link , not just map . anywhere , in expanded card or as
  // suggestions in app." A map pin says where a place is and nothing else.
  await page.locator('#ideas .ideacard').first().click();
  await page.waitForTimeout(400);
  const links = await page.locator('.ilinks a').evaluateAll(
    (a) => a.map((x) => ({ t: x.textContent.trim(), href: x.getAttribute('href') })));
  ok('an opened idea offers somewhere to go', links.length > 0, JSON.stringify(links.map((l) => l.t)));
  // Tapping an idea with no area used to do nothing at all: openIdea read
  // area.t off an undefined filter result and threw before the sheet opened.
  // Harmless in Phu Quoc, where every idea had a hand-assigned area; fatal
  // here, because "Worth a look" is made entirely of the ones that have none.
  ok('and an idea with no area opens at all',
     (await page.locator('#sheet').innerText()).length > 20);
  ok('with no stray "undefined" in it',
     !/undefined/.test(await page.locator('#sheet').innerText()));
  ok('the map is there but last', links[links.length - 1].t === 'Map', JSON.stringify(links.map((l) => l.t)));
  ok('and every link actually goes somewhere', links.every((l) => /^https?:\/\//.test(l.href)));
  await page.screenshot({ path: 'shots/ideas-must.png' });
  await ctx.close();
}

await browser.close();

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
