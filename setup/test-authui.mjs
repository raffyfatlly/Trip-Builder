// Signing up and signing in from the front of the app.
//
// raffy, 2026-09-06: "Implement proper sign-up and sign-in pop-ups and buttons
// on the frontend, while leaving the existing backend authentication mechanism
// intact for now."
//
// The server is deliberately unchanged, so what is checked here is the way in:
// the buttons exist where someone would look, the dialog behaves like a dialog,
// and BOTH tabs still post exactly the body /api/auth/signin already took.
//
//   BASE=http://localhost:3411 node setup/test-authui.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3411';
const SHOT = process.env.SHOT || 'shots';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();

async function app({ accounts = true, user = null, transcript = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const posted = [];
  const errs = [];
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts, user } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript, plan: {}, agentEdits: [], memoryOps: [], steps: [],
    itinerary: null, building: false,
  } }));
  await ctx.route('**/api/auth/signin', (r) => {
    posted.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ json: { user: { email: 'raffy@example.com', phone: '' }, trips: [], memory: null } });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  // Console errors too, not just uncaught pageerrors: React catches a render
  // crash and reports it here, which is the ONLY way the temporal-dead-zone
  // bug in the gate showed up — the page was blank and pageerror was silent.
  // Unmocked endpoints returning 500 are noise, not that.
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errs.push('console: ' + t.slice(0, 300));
  });
  await p.goto(B + '/?s=sesn_X', { waitUntil: 'networkidle' });
  // The app shell first. networkidle can fire before React has hydrated — the
  // first load after a build compiles the page on demand — and every assertion
  // below then looks at an empty document. That is what made this suite pass
  // and fail on alternate runs.
  await p.waitForSelector('header', { timeout: 25000 });
  // Then /api/me APPLIED, rather than a guessed number of milliseconds.
  await p.waitForFunction(
    (want) => !want || !!document.querySelector('header .signin, header .av'),
    accounts, { timeout: 8000 },
  ).catch(() => {});
  return { p, ctx, posted, errs };
}

// The gate fires on an empty session, so these sections hand the page a
// conversation already in progress — the state where signing in is a choice
// rather than the door.
const STARTED = [{ role: 'user', text: 'Chiang Mai in November', id: 'u1' },
  { role: 'assistant', text: 'Lovely time to go.', id: 'a1' }];

console.log('\nThe way in');
{
  const { p, ctx, posted, errs } = await app({ transcript: STARTED });
  ok('there is a Sign in button in the header', await p.locator('header .signin').isVisible());
  ok('and no dialog until it is asked for', await p.locator('.panel[role="dialog"]').count() === 0);

  await p.locator('header .signin').click();
  await p.waitForTimeout(400);
  ok('tapping it opens the dialog', await p.locator('.panel[role="dialog"]').isVisible());
  ok('on the Sign in tab, because that is the button they pressed',
    await p.locator('.tabs button[aria-selected="true"]').innerText() === 'Sign in');
  ok('the email field has focus', await p.evaluate(() => document.activeElement?.id) === 'au-email',
    await p.evaluate(() => document.activeElement?.id));
  ok('signing in does not ask for a phone number',
    await p.locator('#au-phone').count() === 0);
  ok('and cannot be submitted empty', await p.locator('.go').isDisabled());
  await p.screenshot({ path: SHOT + '/auth-signin.png' });

  await p.locator('.tabs button', { hasText: 'Create account' }).click();
  await p.waitForTimeout(250);
  ok('the other tab asks for a phone, optionally', await p.locator('#au-phone').isVisible());
  ok('and says so', (await p.locator('label[for="au-phone"]').innerText()).toLowerCase().includes('optional'));
  await p.screenshot({ path: SHOT + '/auth-signup.png' });

  ok('a half-typed address does not enable it', await (async () => {
    await p.locator('#au-email').fill('raffy@');
    return p.locator('.go').isDisabled();
  })());

  await p.locator('#au-email').fill('raffy@example.com');
  await p.locator('#au-phone').fill('+60 12 345 6789');
  ok('a real one does', !(await p.locator('.go').isDisabled()));

  await p.locator('.go').click();
  await p.waitForTimeout(600);
  ok('it posts what the existing endpoint already takes',
    posted.length === 1 && posted[0].email === 'raffy@example.com'
    && posted[0].phone === '+60 12 345 6789' && Array.isArray(posted[0].trips),
    JSON.stringify(posted[0]));
  ok('the dialog closes on success', await p.locator('.panel[role="dialog"]').count() === 0);
  ok('and the header now shows who they are', await p.locator('header .av').isVisible());
  ok('the Sign in button is gone', await p.locator('header .signin').count() === 0);
  ok('no page errors', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

console.log('\nDismissing it');
{
  const { p, ctx, posted } = await app({ transcript: STARTED });
  await p.locator('header .signin').click();
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('escape closes it', await p.locator('.panel[role="dialog"]').count() === 0);

  await p.locator('header .signin').click();
  await p.waitForTimeout(300);
  // The scrim must genuinely cover the viewport. When its styles went missing
  // it collapsed to the size of the sheet and left the page behind it live —
  // on a fresh session that page is the onboarding form, which is the very
  // screen someone signs up from.
  const scrim = await p.locator('.scrim').boundingBox();
  ok('the scrim covers the whole screen', scrim.width >= 390 && scrim.height >= 844,
    JSON.stringify(scrim));
  const bx = await p.locator('.panel').boundingBox();
  await p.mouse.click(195, Math.max(6, Math.round(bx.y / 2)));   // the scrim above the sheet
  await p.waitForTimeout(300);
  ok('tapping outside closes it', await p.locator('.panel[role="dialog"]').count() === 0);

  await p.locator('header .signin').click();
  await p.waitForTimeout(300);
  await p.locator('.panel .x').click();
  await p.waitForTimeout(300);
  ok('so does the close button', await p.locator('.panel[role="dialog"]').count() === 0);
  ok('and none of that signed anybody in', posted.length === 0);
  await ctx.close();
}

console.log('\nWhen the server says no');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: null } }));
  // A conversation already going, so signing in is a choice here rather than
  // the gate — the gate has its own section below.
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: STARTED, plan: {}, agentEdits: [], memoryOps: [], steps: [],
    itinerary: null, building: false } }));
  await ctx.route('**/api/auth/signin', (r) => r.fulfill({
    status: 500, json: { error: 'Could not open your account. Try again.' } }));
  const p = await ctx.newPage();
  await p.goto(B + '/?s=sesn_X', { waitUntil: 'networkidle' });
  await p.waitForSelector('header .signin', { timeout: 25000 });
  await p.locator('header .signin').click();
  await p.waitForTimeout(300);
  await p.locator('#au-email').fill('raffy@example.com');
  await p.locator('.go').click();
  await p.waitForTimeout(600);
  ok('the error is shown, in its own words', (await p.locator('.err').innerText()).includes('Could not open'));
  ok('the dialog stays open so they can try again', await p.locator('.panel[role="dialog"]').isVisible());
  ok('and the button works again', !(await p.locator('.go').isDisabled()));
  await ctx.close();
}

console.log('\nThe email gate');
{
  // raffy, 2026-09-06: "actually just make sure they have email to start using".
  const { p, ctx, posted } = await app();
  await p.waitForTimeout(900);
  ok('a new visitor gets the dialog without asking', await p.locator('.panel[role="dialog"]').isVisible());
  ok('on the create-account tab',
    await p.locator('.tabs button[aria-selected="true"]').innerText() === 'Create account');
  ok('there is no way to close it', await p.locator('.panel .x').count() === 0);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('escape does nothing', await p.locator('.panel[role="dialog"]').isVisible());
  const bx = await p.locator('.panel').boundingBox();
  await p.mouse.click(195, Math.max(6, Math.round(bx.y / 2)));
  await p.waitForTimeout(300);
  ok('nor does tapping outside', await p.locator('.panel[role="dialog"]').isVisible());
  ok('and it says why the email is needed',
    (await p.locator('.tiny').innerText()).toLowerCase().includes('need it'));
  ok('signing in is still one tap away for someone who has an account',
    await p.locator('.tabs button', { hasText: 'Sign in' }).isVisible());
  await p.screenshot({ path: SHOT + '/auth-required.png' });

  await p.locator('#au-email').fill('raffy@example.com');
  await p.locator('.go').click();
  await p.waitForTimeout(700);
  ok('an email opens the app', await p.locator('.panel[role="dialog"]').count() === 0);
  ok('and it used the same untouched endpoint', posted.length === 1);
  await ctx.close();
}

{
  // The other half of the rule, and the one that matters: it must never take
  // away a trip someone has already made and already paid for.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_X' } }));
  await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: true, user: null } }));
  await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
    transcript: [{ role: 'user', text: 'Chiang Mai in November', id: 'u1' },
      { role: 'assistant', text: 'Lovely time to go.', id: 'a1' }],
    plan: {}, agentEdits: [], memoryOps: [], steps: [], itinerary: null, building: false } }));
  const p = await ctx.newPage();
  await p.goto(B + '/?s=sesn_X', { waitUntil: 'networkidle' });
  await p.waitForSelector('header .signin', { timeout: 25000 });
  await p.waitForTimeout(500);
  ok('someone already mid-conversation is NOT locked out',
    await p.locator('.panel[role="dialog"]').count() === 0);
  ok('but the Sign in button is still there when they want it',
    await p.locator('header .signin').isVisible());
  await ctx.close();
}

console.log('\nDeployments without accounts');
{
  const { p, ctx } = await app({ accounts: false });
  // A button that opens a dialog which then says accounts are not set up is
  // worse than no button.
  ok('no sign-in button at all', await p.locator('header .signin').count() === 0);
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
