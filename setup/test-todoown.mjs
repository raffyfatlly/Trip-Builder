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

// PATHS. This file used to import the renderer and the template from
// /home/user/claude/tools/itinerary-chat — a COPY of this app that lives in the
// vault and stopped being updated on 2026-09-04. So every assertion below was
// being made about code that is not the code that ships: 68 lines of renderer
// behind, and green either way. Both now come from this repo. The trip fixture
// is still read from the vault because that is the only place it exists; it is
// data, not behaviour, so a stale one fails loudly rather than silently.
import fs from 'fs'; import zlib from 'zlib';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { render } from '../renderer/render.js';
const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const T = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/phuquoc.json','utf8'));
const IMG = fs.readFileSync('public/welcome/img/halong.jpg');
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

// --- ticking, crossing, renaming: all of it local ---------------------------
//
// raffy, 2026-09-08: "make it so that user can manually edit to to do part (not
// relying) on agent. anything they say tick or x bring down to confirm
// section." This whole block runs in the DOWNLOADED app, where there is no
// agent to rely on, which is the point.
const vet = () => p.locator('.tdcard', {hasText:'Call the vet'});
const confirmedHas = (t) => p.locator('.tgroup.ok .tdcard', {hasText:t}).count();
ok('it starts on the to-do side', await confirmedHas('Call the vet')===0);
await vet().locator('[data-td-tick]').click(); await p.waitForTimeout(350);
ok('ticking brings it down to Confirmed', await confirmedHas('Call the vet')===1);
ok('and the section is called Confirmed',
   (await p.locator('.sect', {hasText:'Confirmed'}).count())===1);
await vet().locator('[data-td-back]').click(); await p.waitForTimeout(350);
ok('put it back returns it', await confirmedHas('Call the vet')===0);

// The cross settles rather than deletes: it is a decision, not a mistake.
await vet().locator('[data-td-skip]').click(); await p.waitForTimeout(350);
ok('crossing it off also brings it down', await confirmedHas('Call the vet')===1);
ok('and it reads as not needed, not as done',
   /Not needed/i.test(await vet().innerText()), (await vet().innerText()).replace(/\n/g,' | '));
await vet().locator('[data-td-back]').click(); await p.waitForTimeout(350);

// Renaming in place. Two ways in — the title itself, and a pencil in the
// footer for anyone who would never think to tap the words.
ok('there is a pencil to find', await vet().locator('.tdpen').count()===1);
await vet().locator('.tdname').click(); await p.waitForTimeout(200);
ok('tapping the title opens an input', await p.locator('.tdedit').count()===1);
await p.press('.tdedit','Escape'); await p.waitForTimeout(250);
ok('escape leaves the name alone',
   (await p.locator('.tdcard', {hasText:'Call the vet about the cat'}).count())===1);
await vet().locator('.tdpen').click(); await p.waitForTimeout(200);
ok('and so does the pencil', await p.locator('.tdedit').count()===1);
await p.fill('.tdedit','Call the vet AND the neighbour');
await p.press('.tdedit','Enter'); await p.waitForTimeout(350);
ok('and the new name sticks',
   (await p.locator('.tdcard', {hasText:'AND the neighbour'}).count())===1);

await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector('#nav button[data-view="book"]').click());
await p.waitForTimeout(500);
ok('the rename survives a reload',
   (await p.locator('.tdcard', {hasText:'AND the neighbour'}).count())===1);

// EVERYTHING THE TRIP IMPLIES GETS THE SAME TWO MARKS. This is the half that
// did not work before: the flights and the rooms had no tick outside the chat.
const first = p.locator('.tgroup:not(.ok) .tdcard').first();
const firstName = (await first.locator('.tdname').innerText()).trim();
ok('a task the trip put there has a tick too',
   await first.locator('[data-td-tick]').count()===1, firstName);
await first.locator('[data-td-tick]').click(); await p.waitForTimeout(350);
// Once it is done the verb comes off the front — "Booked: Book Kiss Bridge"
// reads like a stutter — so match on what is left of the name.
const firstThing = firstName.replace(/^(Book|Confirm|Sort|Apply for|Arrange|Get|Buy|Renew)\s+/i,'');
ok('and ticking it brings it down as well', await confirmedHas(firstThing)===1, firstThing);
ok('the ring counts it', /1[0-9]?% |[1-9][0-9]?%/.test(await p.locator('.bksum').innerText()),
   (await p.locator('.bksum').innerText()).replace(/\n/g,' | '));

// Delete is only for your own words.
await p.locator('.tgroup.ok .tdcard', {hasText:'AND the neighbour'}).count();
await vet().locator('[data-td-skip]').click(); await p.waitForTimeout(350);
await vet().locator('[data-td-drop]').click(); await p.waitForTimeout(350);
ok('your own line can be deleted for good',
   (await p.locator('.tdcard', {hasText:'AND the neighbour'}).count())===0);
ok('but one the trip owns cannot',
   await p.locator('.tgroup.ok .tdcard', {hasText:firstThing}).locator('[data-td-drop]').count()===0);
ok('no page errors', errs.length===0, errs.join(' / '));
await p.screenshot({path:'shots/todo-manual.png', fullPage:true});
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

// Ticking is local here too — the agent is offered AFTER, on the settled row,
// so filing a confirmation stays possible without being the price of a tick.
const row = f.locator('.tgroup:not(.ok) .tdcard').first();
const rowName = (await row.locator('.tdname').innerText()).trim()
  .replace(/^(Book|Confirm|Sort|Apply for|Arrange|Get|Buy|Renew)\s+/i,'');
await row.locator('[data-td-tick]').click(); await p2.waitForTimeout(400);
const settled = f.locator('.tgroup.ok .tdcard', {hasText:rowName}).first();
ok('a tick inside the chat settles it locally too', await settled.count()===1, rowName);
ok('and only then offers to file the booking',
   await settled.locator('.tdfile').count()===1);
ok('ticking did not open the composer',
   await p2.locator('.dock, [data-dock]').count()===0);
await f.evaluate(()=>window.scrollTo(0,780));
await p2.waitForTimeout(200);
await p2.screenshot({path:'todo-add.png'});
console.log(fail? '\n'+fail+' FAILED':'\nall passed');
await b.close();
process.exit(fail?1:0);
