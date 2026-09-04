// Changing a day without spending a turn.
//
// raffy, 2026-09-04: "i want to make editing the app part easier and more
// intuitive for the users. right now they need to chat to make any changes...
// also ability to like sort the arrangement of the cards of the daily
// activity. y know like tap and move... goal is so we don't need to incur cost
// for every changes they want to make on their own app."
//
// Everything below writes to the same localStorage the times and the packing
// list already use, so the two guards that matter are at the bottom: a drag
// writes a TIME rather than a rank, because every live feature on this screen
// reads the clock; and "Reset this day back to the plan" still puts the day
// back exactly, or the local layer has quietly become a second source of truth.
//
//   node setup/test-dayedit.mjs

import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '/home/user/claude/tools/itinerary-chat/renderer/render.js';
const tpl = zlib.gunzipSync(fs.readFileSync('/home/user/claude/tools/itinerary-chat/public/app-template.html.gz')).toString();
const T = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/phuquoc.json','utf8'));
const IMG = fs.readFileSync('/home/user/claude/tools/itinerary-chat/public/welcome/img/halong.jpg');
const O='https://itinerary.test'; const { html } = render(T, tpl);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true });
await ctx.route(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i, r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx.route('**/api/**', r=>r.fulfill({contentType:'image/jpeg',body:IMG}));
await ctx.route(O+'/', r=>r.fulfill({contentType:'text/html',body:html}));
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
let fail=0; const ok=(n,c,x)=>{console.log((c?'  ok    ':'  FAIL  ')+n+(x?'   '+x:'')); if(!c) fail++;};
await p.goto(O+'/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector('#nav button[data-view="days"]').click());
await p.waitForTimeout(500);

const titles=()=>p.locator('.tl .ev .evh').allInnerTexts();
const before = await titles();
ok('a day starts read-only', await p.locator('.evgrip').count()===0);
ok('and it has items', before.length>=4, before.length+' items');

await p.click('#edtoggle'); await p.waitForTimeout(350);
ok('Edit shows a grip on every item', await p.locator('.evgrip').count()===before.length);
ok('and a delete on every item', await p.locator('.evdel').count()===before.length);
ok('the chevron steps aside', await p.locator('.ev.edit .evchev:visible').count()===0);

// --- edit the title
const h = p.locator('.tl .ev .evh').first();
await h.click();
await p.evaluate(()=>{ const e=document.querySelector('.tl .ev .evh'); e.textContent='Land and go straight to the beach'; });
await p.locator('.tl .ev .evp').first().click();
await p.waitForTimeout(250);
ok('a retitled item keeps the new words', (await titles())[0]==='Land and go straight to the beach', (await titles())[0]);

// --- reload: does it survive?
await p.reload(); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector('#nav button[data-view="days"]').click());
await p.waitForTimeout(500);
ok('and survives a reload', (await titles())[0]==='Land and go straight to the beach');
ok('editing is off again after a reload', await p.locator('.evgrip').count()===0);

// --- delete
await p.click('#edtoggle'); await p.waitForTimeout(300);
const n0=(await titles()).length;
await p.locator('.evdel').nth(1).click(); await p.waitForTimeout(350);
const afterDel = await titles();
ok('deleting takes one off', afterDel.length===n0-1, n0+' -> '+afterDel.length);

// --- add your own
await p.locator('#ownadd').click(); await p.waitForTimeout(400);
ok('adding puts one back', (await titles()).length===afterDel.length+1);
ok('and drops the cursor in it', await p.evaluate(()=>document.activeElement.getAttribute('data-field'))==='h');

// --- drag the first item down past the second
await p.click('#edtoggle'); await p.waitForTimeout(200);   // out
await p.click('#edtoggle'); await p.waitForTimeout(300);   // in, clean render
const pre = await titles();
const g0 = await p.locator('.evgrip').first().boundingBox();
const b1 = await p.locator('.tl .ev').nth(1).boundingBox();
await p.mouse.move(g0.x+14,g0.y+14); await p.mouse.down();
await p.mouse.move(g0.x+14, b1.y+b1.height-6, {steps:14});
await p.mouse.up(); await p.waitForTimeout(450);
const post = await titles();
ok('dragging moves the card', post[0]===pre[1] && post[1]===pre[0], pre.slice(0,2).join(' | ')+'  ->  '+post.slice(0,2).join(' | '));

const mins = await p.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('.v1'))))); 
ok('and writes it as a time, not a rank', Object.keys(mins.times||{}).length>0, JSON.stringify(mins.times));

// --- reset
await p.locator('[data-resetday]').click(); await p.waitForTimeout(400);
ok('reset puts the day back exactly', JSON.stringify(await titles())===JSON.stringify(before), (await titles()).length+' vs '+before.length);
ok('no page errors', errs.length===0, errs.join(' / '));
console.log(fail? '\n'+fail+' FAILED':'\nall passed');
await p.click('#edtoggle'); await p.waitForTimeout(300);
await p.evaluate(()=>window.scrollTo(0,240));
await p.screenshot({path:'edit-mode.png'});
await b.close();
process.exit(fail?1:0);
