// Accounts: the token, the input rules, and the promise that nothing breaks
// when no database is configured. Offline — no Supabase, no API cost.
//
//   BASE=http://localhost:3219 node setup/test-accounts.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import crypto from 'crypto';

process.env.AUTH_SECRET = 'test-secret-for-offline-checks';
const A = await import('../lib/auth.js');
const DB = await import('../lib/db.js');

const B = process.env.BASE || 'http://localhost:3219';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the cookie is the whole of the security model, so lean on it ---------
const token = A.makeToken('user-1');
ok('a token round-trips', A.readToken(token) === 'user-1');
ok('a tampered signature is refused', A.readToken(token.slice(0, -2) + 'zz') === null);
ok('a tampered payload is refused',
   A.readToken(Buffer.from(JSON.stringify({ u: 'user-2', e: Date.now() + 1e6 })).toString('base64url') + '.' + token.split('.')[1]) === null);
ok('an expired token is refused',
   A.readToken((() => {
     const body = Buffer.from(JSON.stringify({ u: 'x', e: Date.now() - 1 })).toString('base64url');
     return body + '.' + crypto.createHmac('sha256', 'test-secret-for-offline-checks').update(body).digest('base64url');
   })()) === null);
ok('junk is refused rather than thrown at', [null, '', 'abc', 'a.b', {}, 123].every((v) => A.readToken(v) === null));
ok('the cookie cannot be read by scripts', A.cookieHeader('t').includes('HttpOnly'));
ok('and does not ride on cross-site requests', A.cookieHeader('t').includes('SameSite=Lax'));

// A different secret must not validate another deployment's token.
const other = (() => {
  process.env.AUTH_SECRET = 'a-different-secret';
  return A.readToken(token);
})();
process.env.AUTH_SECRET = 'test-secret-for-offline-checks';
ok('a token from another secret is refused', other === null);

// --- input rules ---------------------------------------------------------
ok('emails are normalised', A.normaliseEmail('  Raffy@Example.COM ') === 'raffy@example.com');
ok('obvious non-emails are rejected', !A.looksLikeEmail('raffy@') && !A.looksLikeEmail('no'));
ok('phone numbers are tidied', A.normalisePhone('+60 12-345 6789') === '+60123456789');
ok('an empty phone is fine, a bad one is not',
   A.normalisePhone('') === '' && A.normalisePhone('not a phone') === null);
ok('nothing is configured, so accounts are off', DB.backend() === null && !DB.storeConfigured());
ok('two lists merge rather than one replacing the other',
   DB.mergeTripLists([{ id: 'x', label: 'Old', at: 100 }, { id: 'y', label: 'Y', at: 300 }],
                     [{ id: 'x', label: 'New', at: 200 }])
     .map((t) => t.id + ':' + t.label).join(',') === 'y:Y,x:New');
ok('a trip missing from one side survives',
   DB.mergeTripLists([{ id: 'only', label: 'A', at: 1 }], []).length === 1);

const FS = await import('../lib/firestore.js');
ok('the account key does not depend on how you typed your email',
   FS._internals.docId('Raffy@Example.com') === FS._internals.docId('raffy@example.com'));
ok("Firestore's typed values round-trip",
   JSON.stringify(FS._internals.decFields(FS._internals.encFields(
     { email: 'a@b.co', phone: '', trips: [{ id: 's1', label: 'Da Nang', at: 123 }] })))
   === JSON.stringify({ email: 'a@b.co', phone: '', trips: [{ id: 's1', label: 'Da Nang', at: 123 }] }));

// --- with nothing configured, the app is exactly what it was --------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errs = [];
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], building: false, thinking: false, turns: 1 } }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));

const me = await (await ctx.request.get(B + '/api/me')).json();
ok('/api/me says accounts are off rather than erroring', me.accounts === false && me.user === null);
const start = await ctx.request.post(B + '/api/auth/signin', { data: { email: 'a@b.co' } });
ok('signing in is refused cleanly, not with a crash', start.status() === 501);

await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.burger').click();
await page.waitForTimeout(400);
ok('no sign-in offered when there is nowhere to store it', await page.locator('.acct').count() === 0);
ok('and the drawer still works', await page.locator('.drawer .act:has-text("New trip")').count() === 1);
ok('no page errors', errs.length === 0, errs.join(' / '));

// --- with accounts on, the sign-in flow behaves --------------------------
{
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let sentTrips = null;
  await c2.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await c2.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
    itinerary: null, plan: {}, agentEdits: [], building: false, thinking: false, turns: 1 } }));
  await c2.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: null } }));
  await c2.route('**/api/auth/signin', (r) => {
    sentTrips = JSON.parse(r.request().postData());
    r.fulfill({ json: {
      user: { email: 'raffy@example.com', phone: '' },
      trips: [{ id: 'sesn_FROM_ACCOUNT', label: 'Tokyo in November', at: Date.now() - 8e8 }],
    } });
  });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.addInitScript(() => {
    localStorage.setItem('itin.session.v1', 'sesn_LOCAL');
    localStorage.setItem('itin.trips.v1', JSON.stringify([{ id: 'sesn_LOCAL', label: 'Da Nang', at: Date.now() }]));
  });
  await p2.goto(B, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1400);
  await p2.locator('.burger').click();
  await p2.waitForTimeout(400);

  ok('sign-in is offered when accounts are on', await p2.locator('.acct .cta').count() === 1);
  await p2.locator('.acct .cta').click();
  await p2.waitForTimeout(250);
  await p2.locator('input[type=email]').fill('raffy@example.com');
  await p2.locator('input[type=tel]').fill('+60 12 345 6789');
  ok('it says plainly there is no code coming',
     (await p2.locator('.note').innerText()).includes('no code'));
  await p2.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/signin.png' });
  await p2.locator('button:has-text("Save my trips")').click();
  await p2.waitForTimeout(700);

  ok('the trips this browser had are carried in',
     !!sentTrips && (sentTrips.trips || []).some((t) => t.id === 'sesn_LOCAL'));
  ok('the phone is normalised on the way', !!sentTrips && sentTrips.phone.includes('12'));
  ok('signing in shows who you are', (await p2.locator('.acct.in').innerText()).includes('raffy@example.com'));

  const listed = await p2.locator('.drawer .row .lbl').allInnerTexts();
  const ids = () => p2.evaluate(() => JSON.parse(localStorage.getItem('itin.trips.v1') || '[]').map((t) => t.id));
  ok('the account brings its trips with it', listed.includes('Tokyo in November'));
  ok('and does not drop the one this browser was working on', (await ids()).includes('sesn_LOCAL'));
  await p2.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/signedin.png' });

  // Signing out must not read as "delete my trips".
  await c2.route('**/api/auth/signout', (r) => r.fulfill({ json: { ok: true } }));
  await p2.locator('.out').click();
  await p2.waitForTimeout(400);
  ok('signing out keeps the trips on the device', (await ids()).includes('sesn_LOCAL'));
  ok('including the ones the account brought', (await ids()).includes('sesn_FROM_ACCOUNT'));
  ok('and offers sign-in again', await p2.locator('.acct .cta').count() === 1);
  await c2.close();
}

ok('still no page errors', errs.length === 0, errs.join(' / '));
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
