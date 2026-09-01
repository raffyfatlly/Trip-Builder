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
const idea = (n, area) => ({ n, one: 'Worth the trip', time: '2 hours', icon: 'sun', verdict: 'yes', area });

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

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
