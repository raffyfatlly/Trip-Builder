// Adding to your own list without the chat.
//
// raffy, 2026-09-04: "what about add something to your own list part in to do.
// i want they can add easily too. like if offline they don't have to depend on
// the chat right."
//
// It used to post a message to the chat, which is no use on a plane. So the
// first context below is the downloaded app — no parent frame, so LIVE is false
// — and everything has to work there. The second checks that being inside the
// chat still offers the agent as well, since it can find a deadline and a link
// and typing cannot.
//
//   node setup/test-todoown.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '/home/user/claude/tools/itinerary-chat/renderer/render.js';
const tpl = zlib.gunzipSync(fs.readFileSync('/home/user/claude/tools/itinerary-chat/public/app-template.html.gz')).toString();
const T = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/phuquoc.json','utf8'));
const IMG = fs.readFileSync('/home/user/claude/tools/itinerary-chat/public/welcome/img/halong.jpg');
const O='https://itinerary.test'; const { html } = render(T, tpl);
const b = await chromium.launch();
let fail=0; const ok=(n,c,x)=>{console.log((c?'  ok    ':'  FAIL  ')+n+(x?'   '+x:'')); if(!c) fail++;};

// Downloaded, not in the chat: LIVE is false and nothing may depend on it.
const ctx = await b.newContext({ viewport:{width:390,height:844} });
await ctx.route(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i, r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx.route('**/api/**', r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx.route(O+'/', r=>r.fulfill({contentType:'text/html',body:html}));
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(O+'/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector('#nav button[data-view="book"]').click());
await p.waitForTimeout(500);

ok('a downloaded app still offers the box', await p.locator('#tdnew').count()===1);
ok('and does not offer the chat route', await p.locator('.tdask').count()===0);

const own = () => p.locator('.tgroup .tdcard', {hasText:'Call the vet'}).count();
await p.fill('#tdnewin','Call the vet about the cat');
await p.press('#tdnewin','Enter'); await p.waitForTimeout(350);
ok('typing one adds it', await own()===1, (await p.evaluate(()=>[...document.querySelectorAll('.sect h2')].map(x=>x.textContent).join(' / '))));
ok('it lands on his own list',
   (await p.locator('.sect', {hasText:'Your own list'}).count())===1);

await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector('#nav button[data-view="book"]').click());
await p.waitForTimeout(500);
ok('and survives a reload', await own()===1);

const sortedHas = () => p.locator('.tgroup.ok .tdcard', {hasText:'Call the vet'}).count();
ok('it starts on the to-do side', await sortedHas()===0);
await p.locator('[data-mine-tick]').first().click(); await p.waitForTimeout(350);
ok('ticking moves it to Sorted', await sortedHas()===1);
await p.locator('[data-mine-tick]').first().click(); await p.waitForTimeout(350);
ok('and unticking brings it back', await sortedHas()===0);

await p.locator('[data-mine-off]').first().click(); await p.waitForTimeout(350);
ok('the cross removes it for good', await own()===0);
ok('no page errors', errs.length===0, errs.join(' / '));
await ctx.close();

// Inside the chat, the ask-me route is offered as well.
const ctx2 = await b.newContext({ viewport:{width:390,height:844} });
await ctx2.route(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i, r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx2.route('**/api/**', r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx2.route(O+'/app', r=>r.fulfill({contentType:'text/html',body:html}));
await ctx2.route(O+'/', r=>r.fulfill({contentType:'text/html',body:'<style>html,body{margin:0}iframe{border:0;width:390px;height:844px;display:block}</style><iframe src="/app"></iframe>'}));
const p2 = await ctx2.newPage();
await p2.goto(O+'/',{waitUntil:'domcontentloaded'}); await p2.waitForTimeout(1100);
const f = p2.frames().find(x=>x.url().endsWith('/app'));
await f.evaluate(()=>document.querySelector('#nav button[data-view="book"]').click());
await p2.waitForTimeout(500);
ok('in the chat, both routes are there',
   await f.locator('#tdnew').count()===1 && await f.locator('.tdask').count()===1);
await f.evaluate(()=>window.scrollTo(0,780));
await p2.waitForTimeout(200);
await p2.screenshot({path:'todo-add.png'});
console.log(fail? '\n'+fail+' FAILED':'\nall passed');
await b.close();
process.exit(fail?1:0);
