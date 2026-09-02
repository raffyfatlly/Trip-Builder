// The chrome around the trip carries its own fonts.
//
// raffy, 2026-09-02, of his Desaru app: "its not using the font I ask you to
// fix for all app. its still using the old font. not my phu quoc font."
//
// The generated trip embeds its faces and always had them — measured on his own
// itinerary, both loaded, both applied. THIS page — the title, the tabs, the
// dock — was pulling them from Google Fonts over the network. On a slow phone
// that renders the whole shell in the system font until the CSS arrives, next
// to an iframe that already has its own. A face the app depends on should not
// be a request that can lose.
//
//   BASE=http://localhost:3284 node setup/test-shellfont.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3284';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

// Google Fonts blocked outright: the shell must not care.
const blocked = [];
await ctx.route('**://fonts.googleapis.com/**', (r) => { blocked.push(r.request().url()); r.abort(); });
await ctx.route('**://fonts.gstatic.com/**', (r) => { blocked.push(r.request().url()); r.abort(); });
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_Z' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [{ role: 'user', text: 'hi', id: 'u1' }],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_Z'));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

console.log('');
ok('no page errors', errs.length === 0, errs.join(' / '));
ok('it never asks Google for a font', blocked.length === 0, blocked.join(' '));

// A declared face that 404s fails silently — the page just renders in the
// fallback and looks subtly wrong, which is exactly the complaint. Forcing the
// load is what proves the URL in the @font-face actually resolves.
const state = await page.evaluate(async () => {
  await document.fonts.ready;
  const got = async (spec) => {
    try { return (await document.fonts.load(spec)).length > 0; } catch (e) { return false; }
  };
  const outfit = await got('700 24px Outfit');
  const jakarta = await got('400 16px "Plus Jakarta Sans"');
  // Not a live element: the first screen is onboarding and legitimately has
  // no Outfit on it. What matters is that the rule exists and the face behind
  // it resolves — a declared face pointing at a 404 fails silently.
  return {
    outfit, jakarta,
    faces: [...document.fonts].map((f) => f.family + ':' + f.status),
    body: getComputedStyle(document.body).fontFamily,
    declaresOutfit: [...document.querySelectorAll('style')]
      .some((n) => /font-family:'Outfit'/.test(n.textContent)),
  };
});
ok('Outfit resolves from our own origin', state.outfit, state.faces.join(' | '));
ok('and so does Jakarta', state.jakarta, state.faces.join(' | '));
ok('the shell asks for Jakarta first', /Plus Jakarta Sans/.test(state.body), state.body);
ok('and the page still styles its headings with Outfit', state.declaresOutfit);

// The files themselves, since a @font-face pointing at a 404 fails silently.
for (const f of ['outfit', 'jakarta']) {
  const r = await page.request.get(B + '/' + f + '.woff2');
  ok(f + '.woff2 is actually served', r.ok() && (await r.body()).length > 10000,
     r.status() + ', ' + (await r.body()).length + ' bytes');
}

await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/shellfont.png' });
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
