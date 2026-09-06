// The landmark icons, on an actual map rather than a contact sheet.
//
// A glyph that reads fine at 40px in a grid can be mush at 16px on a route,
// which is the only size that matters. This renders a real trip and photographs
// the Explore map so that can be judged.
//
//   node setup/shot-icons.mjs

import fs from 'fs';
import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const BASE = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

// The shipped fixture has no coordinates on its items or ideas, so it draws
// nothing but the stay — which is exactly the tier this change does not touch.
// Real Da Nang places, real positions, chosen so some match a glyph and some
// deliberately do not.
const PLACES = [
  ['Linh Ung Pagoda', 16.1002, 108.2776],          // temple
  ['My Khe Beach', 16.0575, 108.2470],             // beach
  ['Marble Mountains', 16.0035, 108.2635],         // mountain
  ['Han Market', 16.0685, 108.2240],               // market
  ['Dragon Bridge', 16.0614, 108.2270],            // bridge
  ['Museum of Cham Sculpture', 16.0605, 108.2237], // museum
  ['Son Tra Peak viewpoint', 16.1180, 108.2960],   // viewpoint
  ['Hoi An Memories Show', 15.8790, 108.3450],     // no glyph, on purpose
  ['Thuan Phuoc Field', 16.0930, 108.2100],        // no glyph, on purpose
];
const T = JSON.parse(JSON.stringify(BASE));
T.days = (T.days || []).slice(0, 3).map((d, di) => ({
  ...d,
  items: PLACES.slice(di * 2, di * 2 + 2).map(([h, lat, lon]) => ({
    ...(d.items || [])[0], h, lat, lon,
  })),
}));
T.ideas = (T.ideas || []).slice(0, 3).map((i, n) => {
  const [nm, lat, lon] = PLACES[6 + n];
  return { ...i, n: nm, lat, lon };
});
const { html } = render(T, tpl);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
// The ground tile is a Google request this sandbox cannot make; a flat fill
// stands in so the markers are what is being looked at.
await ctx.route('**/api/map**', (r) => r.fulfill({
  status: 200, contentType: 'image/svg+xml',
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">'
    + '<rect width="640" height="640" fill="#F2F8F3"/></svg>',
}));
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.locator('nav button, nav a, .tabbar button, .tabbar a, [data-tab]')
  .filter({ hasText: /explore/i }).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2500);

const icons = await page.locator('#routemap svg.pins g.icon').count();
const plain = await page.locator('#routemap svg.pins g.plan:not(.icon), #routemap svg.pins g.spot:not(.icon)').count();
console.log(icons + ' markers with a landmark glyph, ' + plain + ' left as plain rings');

const map = page.locator('#routemap').first();
if (await map.count()) await map.screenshot({ path: 'shots/map-icons.png' });
else await page.screenshot({ path: 'shots/map-icons.png' });
await browser.close();
