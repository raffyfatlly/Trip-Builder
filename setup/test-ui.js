// End-to-end test through the real UI: type a message, wait for the chat
// agent, wait for the builder, confirm the preview renders.
//
// Screenshots verify appearance; only driving the interactions verifies
// behaviour, so this types into the real composer and reads the real DOM.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const TARGET = process.argv[2] || 'http://localhost:3210/';
const OUT = new global.URL('../shots/', import.meta.url).pathname;
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
});
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await pg.goto(TARGET, { waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
await pg.screenshot({ path: OUT + '1-empty.png' });
console.log('loaded. intro visible:', await pg.locator('.intro h1').isVisible());

// Click and type rather than fill: fill sets the value directly, which a
// controlled React input can miss if hydration has not finished.
await pg.click('textarea');
await pg.locator('textarea').pressSequentially(
  "hi, going to Da Nang Vietnam with my wife Aisyah and our two kids, Adam is 6 and Nur is 3. " +
  "10 to 14 September. staying at Furama Resort the whole time. we're muslim so halal food matters.",
  { delay: 1 });
await pg.waitForSelector('.sendbtn:not([disabled])', { timeout: 15000 });
await pg.click('.sendbtn');
console.log('sent.');

// The chat agent should reply, then start the builder.
const t0 = Date.now();
let sawWorking = false;
for (let i = 0; i < 240; i++) {
  await pg.waitForTimeout(2000);
  const working = await pg.locator('.working').count();
  if (working) sawWorking = true;
  const msgs = await pg.locator('.msg.assistant:not(.typing)').count();
  const fab = await pg.locator('.fab').count();
  if (i % 10 === 0) {
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  replies:${msgs} building:${working} preview:${fab}`);
  }
  // Wait for the build to FINISH, not just for the preview to appear — the
  // builder writes trip and stays before it writes any days.
  if (fab && !working) break;
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\nbuilder started (working indicator seen): ${sawWorking}`);
console.log(`itinerary ready after ${secs}s: ${(await pg.locator('.fab').count()) > 0}`);

await pg.screenshot({ path: OUT + '2-chat.png' });

const reply = await pg.locator('.msg.assistant').last().innerText().catch(() => '');
console.log('\nlast reply:\n' + reply.split('\n').map((l) => '  ' + l).join('\n'));

if (await pg.locator('.fab').count()) {
  await pg.click('.fab');
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: OUT + '3-preview.png' });

  const frame = pg.frameLocator('iframe');
  const title = await frame.locator('.hero h1').innerText().catch(() => '(none)');
  const crew = await frame.locator('.crew .cap').innerText().catch(() => '(none)');
  const days = await frame.locator('#strip button').count().catch(() => 0);
  console.log('\npreview title: ' + title.replace(/\n/g, ' / '));
  console.log('preview crew:  ' + crew);
  console.log('preview days:  ' + days);
  console.log('download button: ' + (await pg.locator('.dl').count() > 0));
}

// Pull the raw state so a missing preview can be diagnosed rather than guessed.
const sid = await pg.evaluate(() => localStorage.getItem('itin.session.v1'));
const st = await (await fetch(TARGET.replace(/\/$/, '') + '/api/state?session=' + sid)).json();
console.log('\nsession: ' + sid);
console.log('state: building=' + st.building + ' thinking=' + st.thinking);
if (st.itinerary) {
  const it = st.itinerary;
  console.log('itinerary: days=' + (it.days||[]).length + ' stays=' + (it.stays||[]).length +
    ' ideas=' + (it.ideas||[]).length + ' trip=' + (it.trip ? it.trip.title : 'none'));
} else {
  console.log('itinerary: NULL');
}

console.log('\npage errors: ' + (errs.length ? errs.slice(0, 6).join(' | ') : 'none'));
await browser.close();
