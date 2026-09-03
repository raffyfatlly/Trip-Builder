// The day's numbers, as a card of columns rather than a row of loose pills.
//
// raffy, 2026-09-03, pointing at a reference: "if the app structure and design
// can be polished like in reference would be great." The reference itinerary
// puts distance, cost and CO2 in one bordered card with a label above each
// value. A pill says "here is a value"; a column says what the value is of.
//
//   node setup/test-statcard.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const T = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ORIGIN = 'https://itinerary.test';

const { html } = render(T, tpl);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('**/api/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
await ctx.route(ORIGIN + '/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
// The nav can sit under the intro screen on first paint, so fire the handler
// rather than the pointer.
await page.evaluate(() => document.querySelector('#nav button[data-view="days"]').click());
await page.waitForTimeout(700);

console.log('');
ok('no page errors', errs.length === 0, errs.join(' / '));

const card = page.locator('.stats').first();
ok('the day carries a stat card', await card.count() > 0);

const cols = await page.locator('.stats .st').count();
ok('it has columns, not pills', cols >= 2, cols + ' columns');

const labels = await page.locator('.stats .sl').allInnerTexts();
ok('every column says what it is', labels.length === cols && labels.every((l) => l.trim().length > 2), labels.join(' | '));

const vals = await page.locator('.stats .sv').allInnerTexts();
ok('and carries a value', vals.every((v) => v.trim().length > 1), vals.join(' | '));
ok('no undefined icon leaked in', !(await page.content()).includes('undefined<span class="sl"'));

// the icons come from the template's own set, so a missing key shows as blank
const icons = await page.locator('.stats .st svg').count();
ok('each column has its mark', icons === cols, icons + ' of ' + cols);

const state = await page.evaluate(() => {
  const v = document.getElementById('v-days');
  const hello = document.getElementById('hello');
  return {
    daysHidden: v ? v.hasAttribute('hidden') : null,
    helloShown: hello ? getComputedStyle(hello).display !== 'none' && hello.offsetHeight > 0 : false,
    statsW: (document.querySelector('.stats') || {}).offsetWidth,
  };
});
console.log('  state ' + JSON.stringify(state));
ok('the days view is showing', state.daysHidden === false);
ok('the card fits the screen', state.statsW > 200 && state.statsW <= 370, state.statsW + 'px');

await page.screenshot({ path: 'shots/app-day.png', fullPage: false });

await browser.close();
console.log(fail ? '\n' + fail + ' failed\n' : '\nall good\n');
process.exit(fail ? 1 : 0);
