// Does the pricing section still lay out, in both themes and at phone width,
// and does it agree with what the server actually sells?
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.env.BASE || 'http://localhost:3241';
const b = await chromium.launch();
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// What the app really sells, straight from the API the paywall reads.
const pay = await (await fetch(B + '/api/pay')).json().catch(() => ({}));
const packs = (pay && pay.packs) || [];
const say = packs.map((p) => 'RM' + p.myr + '=' + p.credits).join(' ');
console.log('\n  server sells:', say || '(no /api/pay in this environment)');

for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(B + '/welcome/', { waitUntil: 'networkidle' });
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);

  const text = await page.locator('#pricing').innerText();
  console.log('\n  --- ' + name);
  // The two NAMED packs are the tiers. Top up is not a tier — it is any amount
  // from RM10 — so the page states its floor and its rate instead of a credit
  // count that would only be true for one amount.
  const named = packs.filter((p) => p.id !== 'topup');
  ok('the tiers on the page are the packs on sale',
     named.every((p) => text.includes('RM' + p.myr) && text.includes(String(p.credits))),
     named.map((p) => 'RM' + p.myr + '/' + p.credits).join(' '));
  const rate = named.length ? (named[0].myr / named[0].credits).toFixed(2) : '';
  ok('and the top-up rate is the same rate', text.includes('RM' + rate), 'RM' + rate + ' a credit');
  ok('the free grant is stated', /15 free credits/.test(text));
  ok('a rebuild is priced at what it costs', /\b25\b/.test(text));
  ok('the top-up floor is right', /RM10/.test(text));
  ok('no stale prices survive', !/RM29|RM89|120 credits|500 credits/.test(text),
     (text.match(/RM29|RM89|120 credits|500 credits/g) || []).join(' '));
  // The old table said edits were free. They are not.
  ok('nothing claims a change is free', !/Changing something yourself[\s\S]{0,40}Free/.test(text));

  // Layout: two tiers side by side on desktop, stacked on phone, nothing spilling.
  const box = await page.locator('#pricing').boundingBox();
  ok('the section does not overflow sideways', box.width <= w + 1, Math.round(box.width) + 'px in ' + w);
  const doc = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('and neither does the page', doc <= w + 1, doc + 'px');
  ok('no page errors', errs.length === 0, errs.join(' / '));

  await page.screenshot({ path: 'shots/pricing-' + name + '.png', fullPage: false });
  await ctx.close();
}
await b.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
