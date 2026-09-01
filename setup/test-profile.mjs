// The profile: one store, editable by the person it describes, and an offer to
// save it that does not become a nag.
//
//   BASE=http://localhost:3272 node setup/test-profile.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { applyMemory, editSlot, peopleText, parsePeople, filledCount, memoryBlock } from '../lib/memory.js';

const B = process.env.BASE || 'http://localhost:3272';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const T = Date.UTC(2026, 7, 31);

// --- one store, not two --------------------------------------------------
let m = applyMemory(null, 'remember', {
  name: 'Raffy',
  people: [{ name: 'Aisyah' }, { name: 'Adam', age: 6 }, { name: 'Nur', age: 3, note: 'naps early' }],
  home: 'Kuala Lumpur', dietary: 'halal',
}, T);
ok('the profile holds their own name', m.name === 'Raffy');
ok('and the family, in the same place', m.people.length === 3);
ok('the agent is told what to call them', memoryBlock(m, T).includes('called Raffy'));

// --- editable by hand, and it survives the round trip --------------------
const txt = peopleText(m.people, T);
ok('people read back as a plain line', txt === 'Aisyah, Adam (6), Nur (3) — naps early');
ok('and parse back unchanged', peopleText(parsePeople(txt, T), T) === txt);
ok('an age still ages after a hand edit',
   parsePeople('Adam (6)', T)[0].bornAbout === 2020);

m = editSlot(m, 'name', 'Raffy F', T);
ok('a hand edit sticks', m.name === 'Raffy F');
m = editSlot(m, 'people', 'Aisyah, Adam (7)', T);
ok('editing the family replaces it', m.people.length === 2 && m.people[1].age === 7);
ok('a blank edit is ignored rather than wiping the line',
   editSlot(m, 'home', '   ', T).home === 'Kuala Lumpur');
ok('an unknown field is refused', editSlot(m, 'nonsense', 'x', T) === m);
ok('filledCount counts what is known', filledCount(m) === 4);

// --- in the browser ------------------------------------------------------
const browser = await chromium.launch();
const errs = [];
const scenario = async (opts) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: opts.user || null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
    building: false, thinking: false, turns: 1 } }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((s) => {
    localStorage.setItem('itin.session.v1', 'sesn_X');
    if (s.mem) localStorage.setItem('itin.memory.v1', JSON.stringify(s.mem));
    if (s.nudgeAt != null) localStorage.setItem('itin.saveprofile.v1', String(s.nudgeAt));
  }, opts);
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.locator('.burger').click();
  await page.waitForTimeout(500);
  const expand = async () => {
    await page.locator('.proftoggle').click();
    await page.waitForTimeout(350);
  };
  return { ctx, page, expand };
};

{
  const { ctx, page, expand } = await scenario({ mem: m });
  // raffy, 2026-09-01: "for profile i prefer it we click the account and
  // expand. not live in side bar." So it is one row until asked for.
  ok('the drawer shows one identity row, not the whole profile',
     (await page.locator('.proftoggle').count()) === 1 && (await page.locator('.prow').count()) === 0);
  ok('and the row says whose it is', (await page.locator('.proftoggle').innerText()).includes('Raffy'));
  ok('with a hint of what is inside', (await page.locator('.proftoggle').innerText()).includes('Adam'));
  await expand();
  ok('every known field is listed once expanded', (await page.locator('.prow').count()) >= 4);
  ok('signing in lives inside it too', (await page.locator('.profbody .acct').count()) === 1);
  ok('and the family reads naturally',
     (await page.locator('.prof').innerText()).includes('Adam (7)'));

  // Correcting it by hand.
  await page.locator('.prow').first().locator('.pval').click();
  await page.waitForTimeout(200);
  await page.locator('.prow input').fill('Raffy Fatlly');
  await page.locator('.prow input').press('Enter');
  await page.waitForTimeout(400);
  ok('a row can be corrected in place',
     (await page.evaluate(() => JSON.parse(localStorage.getItem('itin.memory.v1')).name)) === 'Raffy Fatlly');
  await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/profile.png' });
  await ctx.close();
}

// --- the offer to save ---------------------------------------------------
{
  // Barely anything known: not worth asking about yet.
  const { ctx, page } = await scenario({ mem: applyMemory(null, 'remember', { name: 'Sam' }, T) });
  ok('it does not ask before there is anything to lose', await page.locator('.saveme').count() === 0);
  await ctx.close();
}
{
  const { ctx, page } = await scenario({ mem: m });
  ok('it asks once the profile is worth keeping', await page.locator('.saveme').count() === 1);
  await page.locator('.saveme .later').click();
  await page.waitForTimeout(300);
  ok('"Not now" puts it away', await page.locator('.saveme').count() === 0);
  await ctx.close();
}
{
  // Said no at 4 things known; still 4, so it stays quiet.
  const { ctx, page } = await scenario({ mem: m, nudgeAt: 4 });
  ok('and it stays away while nothing has changed', await page.locator('.saveme').count() === 0);
  await ctx.close();
}
{
  // Said no at 2; the profile has grown since, so it is fair to ask again.
  const { ctx, page } = await scenario({ mem: m, nudgeAt: 2 });
  ok('but asks again once the profile has grown', await page.locator('.saveme').count() === 1);
  await ctx.close();
}
{
  const { ctx, page } = await scenario({ mem: m, user: { email: 'a@b.co', phone: '' } });
  ok('never asks someone already signed in', await page.locator('.saveme').count() === 0);
  await ctx.close();
}

ok('no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
