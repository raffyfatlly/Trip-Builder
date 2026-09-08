// Does the pricing section still lay out, in both themes and at phone width,
// and does it agree with what the server actually sells?
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.env.BASE || 'http://localhost:3241';
const b = await chromium.launch();
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// What the app really sells, straight from the API the paywall reads, and the
// two constants that never reach it — what a new account is given, and what
// planning a trip again costs. Asserting against these rather than against a
// sentence means the page can be reworded freely and still has to be true.
const pay = await (await fetch(B + '/api/pay')).json().catch(() => ({}));
const packs = (pay && pay.packs) || [];
const { explain, rebuildCredits } = await import('../lib/credits.js');
const money = Object.assign({ rebuildCredits: rebuildCredits() }, explain());
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
  ok('the free credits a new account gets are stated',
     new RegExp('\\b' + money.grant + '\\b[^.]{0,40}free|free[^.]{0,40}\\b' + money.grant + '\\b', 'i').test(text),
     money.grant + ' free');
  // Topping up is not on this page any more and should not come back to it: it
  // is a thing that happens mid-trip, inside the app, where the paywall states
  // the floor and the rate. A landing page explaining it was fine print under
  // the best thing on the page.
  ok('topping up is left to the app', !/top up|top-up/i.test(text));
  ok('no stale prices survive', !/RM29|RM89|120 credits|500 credits/.test(text),
     (text.match(/RM29|RM89|120 credits|500 credits/g) || []).join(' '));
  // The old table said edits were free. They are not.
  ok('nothing claims a change is free', !/Changing something yourself[\s\S]{0,40}Free/.test(text));

  // WHAT THEY WALK AWAY WITH LEADS. raffy, 2026-09-08: "opening seems like no
  // value. that's an app that they can have, that's huge right." A charge list
  // that renders keeping the app as a row saying "Free" is the smallest
  // possible way to say the biggest thing on the page.
  ok('the app they keep is stated at full size',
     /yours to keep/i.test(text) && !/Opening a trip you already have/.test(text));
  // NOTHING ITEMISED, AND NOTHING OVER-PROMISED. raffy, 2026-09-08: "it never
  // ask u for anything again is unnecessary" and "no need explanation about the
  // credit included". The packs say what money buys and the line above says
  // what a credit is; anything past that is an argument nobody is having.
  ok('no charge list has grown back',
     !/Changing a time|Asking it to look one thing up|Planning it again/i.test(text));
  ok('and no promise nobody asked for',
     !/never asks you for anything/i.test(text));

  // THE SAME PLAIN-ENGLISH RULE THE AGENT WORKS TO. raffy, 2026-09-08: "use
  // better language." Most people reading this learned English at school in
  // Malaysia or Indonesia, and business slang is the part that cannot be
  // looked up.
  const SLANG = ['bulk discount', 'no catch', 'run low', 'ballpark', 'bang for',
                 'no-brainer', 'the works', 'off the beaten', 'hassle-free',
                 'unlock', 'seamless', 'supercharge'];
  const found = SLANG.filter((w) => text.toLowerCase().includes(w));
  ok('no slang a second-language reader has to decode', found.length === 0, found.join(', '));
  // And a credit is explained before anybody is asked to buy one.
  ok('it says what a credit actually is',
     /Credits are what you spend/i.test(text));

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
