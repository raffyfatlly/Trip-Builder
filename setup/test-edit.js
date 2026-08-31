// Drives the manual editor through the real UI.
//
// Reuses an already-built session rather than waiting four minutes for a fresh
// build: the editor is what is under test, not the builder.
//
//   node setup/test-edit.js <sessionId> [url]

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const SESSION = process.argv[2];
if (!SESSION) throw new Error('pass a session id with a built itinerary');
const TARGET = process.argv[3] || 'http://localhost:3210/';
const OUT = new global.URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

// Seed the session id the same way the app does.
let firstLoad = true;
await ctx.addInitScript((s) => {
  try { localStorage.setItem('itin.session.v1', s); } catch (e) {}
}, SESSION);

const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts/.test(m.text())) errs.push(m.text()); });

await pg.goto(TARGET, { waitUntil: 'networkidle' });
// Start from a clean slate, but only once — clearing on every load would also
// wipe the edits the reload check is meant to verify.
await pg.evaluate((s) => { try { localStorage.removeItem('itin.edits.' + s); } catch (e) {} }, SESSION);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.fab', { timeout: 40000 });
await pg.click('.fab');
await pg.waitForTimeout(1200);
console.log('itinerary loaded, sheet open');

// Preview first, so a before/after comparison is possible.
const before = await pg.frameLocator('iframe').locator('#daypanel .ev').count().catch(() => 0);

await pg.click('.seg button:has-text("Edit")');
await pg.waitForTimeout(500);
await pg.screenshot({ path: OUT + '4-edit.png' });

const cards = await pg.locator('.editor .card').count();
console.log('editable items on day 1: ' + cards);
const firstHeading = await pg.locator('.editor .card .h').first().innerText();
console.log('first item: ' + firstHeading);

// --- edit an item -------------------------------------------------------
await pg.locator('.editor .card').first().click();
await pg.waitForTimeout(300);
await pg.locator('.ed input').nth(1).fill('EDITED BY HAND');
await pg.click('.ed .save');
await pg.waitForTimeout(500);
const afterEdit = await pg.locator('.editor .card .h').first().innerText();
console.log('after edit:  ' + afterEdit);

// --- add an item --------------------------------------------------------
await pg.click('.editor .add');
await pg.waitForTimeout(300);
await pg.locator('.ed input').nth(0).fill('4:30pm');
await pg.locator('.ed input').nth(1).fill('ADDED BY HAND');
await pg.locator('.ed textarea').first().fill('A manually added stop.');
await pg.click('.ed .save');
await pg.waitForTimeout(500);
const afterAdd = await pg.locator('.editor .card').count();
console.log('items after add: ' + afterAdd + ' (was ' + cards + ')');

const order = await pg.locator('.editor .card .t').allInnerTexts();
console.log('times in order: ' + order.join(' | '));

// --- delete an item -----------------------------------------------------
await pg.locator('.editor .card').last().click();
await pg.waitForTimeout(300);
await pg.click('.ed .del');
await pg.waitForTimeout(500);
const afterDel = await pg.locator('.editor .card').count();
console.log('items after delete: ' + afterDel);

const badge = await pg.locator('.seg .count').innerText().catch(() => '(none)');
console.log('edit counter: ' + badge);

// --- does the preview reflect the edits? --------------------------------
await pg.click('.seg button:has-text("Preview")');
await pg.waitForTimeout(1800);
await pg.screenshot({ path: OUT + '5-edited-preview.png' });

const frame = pg.frameLocator('iframe');
const inPreview = await frame.locator('body').innerHTML();
console.log('');
console.log('preview shows the hand edit:  ' + inPreview.includes('EDITED BY HAND'));
console.log('preview shows the added item: ' + inPreview.includes('ADDED BY HAND'));

// --- do edits survive a reload? -----------------------------------------
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.fab', { timeout: 40000 });
await pg.click('.fab');
await pg.waitForTimeout(2000);
const persisted = await pg.frameLocator('iframe').locator('body').innerHTML();
console.log('edits survive a reload:       ' + persisted.includes('EDITED BY HAND'));

console.log('\npage errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
await browser.close();
