// The Bookings tab.
//
// raffy, 2026-09-01: "it misses the handling the booking part... we need app
// that keep their flight bookings , hotel bookings etc. so they just open the
// app and everything is kept nicely for them in there."
//
// The tab is INSERTED into the pinned template rather than spliced over
// something existing — there is no Phu Quoc bookings section to replace. Two
// things this guards:
//
//   1. It must land as a sibling of the other views, not inside one. The first
//      marker swallowed the </section> that closes the day view, so Bookings
//      nested inside Days, inherited [hidden], and rendered at zero height
//      while reporting display:block. Nothing looked wrong in the HTML.
//   2. A stay with `draft` set has to read as NOT booked. Surfacing that is the
//      entire point of the tab.
//
//   node setup/test-bookings.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';
const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const REAL = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json','utf8'));
// Two stays, one still a draft — the case the tab exists for.
const T = { ...REAL, stays: [ { ...REAL.stays[0] }, { ...REAL.stays[0], n:'La Siesta Hoi An', short:'La Siesta', dates:'12 to 14 Sep', nights:'2 nights', draft:true } ] };
const { html } = render(T, tpl);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:390,height:800} })).newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
await p.route('**maps.wikimedia.org**', r=>r.fulfill({contentType:'image/png', body:PNG}));
await p.setContent(html, { waitUntil:'domcontentloaded' });
await p.waitForTimeout(900);
let fail=0; const ok=(n,c,x)=>{console.log((c?'  ok    ':'  FAIL  ')+n+(x?'   '+x:''));if(!c)fail++;};
ok('no page errors', errs.length===0, errs.join(' / '));
ok('the nav has four tabs', await p.locator('#nav button').count()===4);
await p.locator('#nav button[data-view="book"]').click();
await p.waitForTimeout(400);
ok('the bookings view opens', await p.locator('#v-book').isVisible());
const t = await p.locator('#bookings').innerText();
ok('it counts what is sorted', /of 3 sorted/.test(t), t.split('\n')[0]);
ok('the booked stay says booked', t.includes('Furama') && /booked/i.test(t));
ok('the draft stay says not booked', t.includes('La Siesta') && /not booked/i.test(t));
ok('and it asks for the missing flights', t.includes('No flights yet'));
await p.screenshot({ path:'/home/user/claude/tools/itinerary-chat/shots/bookings.png' });
await b.close();
console.log(fail?'\n'+fail+' FAILED':'\nall passed');
process.exit(fail?1:0);
