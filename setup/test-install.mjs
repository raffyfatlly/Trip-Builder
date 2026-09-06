// Installing the trip: one tap where the browser allows it, the real steps
// where it does not.
//
// raffy, 2026-09-06: "when i click install app, it opens the app on my next tab
// in browser. how to install as app? for both android and iphone."
//
//   BASE=http://localhost:3411 node setup/test-install.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://localhost:3411';
const TRIP = process.env.TRIP || 'sesn_01WDtF9sMZTNcuFA9ES3nSW4';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const browser = await chromium.launch();

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

async function open(ua, { standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua });
  if (standalone) {
    // What the page sees once it has been installed and launched from the home
    // screen. The bar must not be there then.
    await ctx.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: standalone')
        ? { matches: true, media: q, addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {} }
        : real(q));
    });
  }
  const p = await ctx.newPage();
  await p.goto(B + '/t/' + TRIP, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  return { p, ctx };
}

console.log('\nThe manifest, which is what makes any of it possible');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const r = await p.goto(B + '/api/manifest?s=' + TRIP);
  const m = await r.json();
  ok('it is served as a manifest', (r.headers()['content-type'] || '').includes('manifest'));
  ok('it names the trip, not the tool', !!m.name && m.name !== 'Trip Builder', m.name);
  ok('it opens standalone', m.display === 'standalone');
  ok('it starts at this trip', m.start_url.includes(TRIP));
  // PNG, not SVG. Android mints a real installed app only from a raster icon;
  // given an SVG it falls back to a browser shortcut, and a shortcut is what
  // carries the little Chrome badge raffy asked to be rid of.
  ok('every icon is a PNG', (m.icons || []).length > 0
    && (m.icons || []).every((i) => i.type === 'image/png'),
    JSON.stringify((m.icons || []).map((i) => i.type)));
  ok('there is a 192 and a 512, which is what Android asks for',
    ['192x192', '512x512'].every((sz) => (m.icons || []).some((i) => i.sizes === sz)));
  ok('and one is maskable, so the launcher can crop it to its own shape',
    (m.icons || []).some((i) => (i.purpose || '').includes('maskable')));

  for (const i of m.icons || []) {
    const res = await p.goto(B + i.src);
    ok('  ' + i.src + ' is really there', res.status() === 200 && (res.headers()['content-type'] || '').includes('png'),
      res.status() + ' ' + res.headers()['content-type']);
  }
  await ctx.close();
}

console.log('\nThe page offers a worker to register');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const r = await p.goto(B + '/sw.js');
  const body = await r.text();
  ok('the service worker is served as javascript',
    (r.headers()['content-type'] || '').includes('javascript'));
  // Installability needs a fetch handler specifically — a worker without one
  // does not qualify, however correct it otherwise is.
  ok('and it has a fetch handler, which is the part that counts',
    /addEventListener\(\s*['"]fetch['"]/.test(body));
  await ctx.close();
}

console.log('\nOn an iPhone, where Apple gives no API');
{
  const { p, ctx } = await open(IPHONE);
  ok('iOS gets its own icon, or the home screen shows a screenshot instead',
    await p.locator('link[rel="apple-touch-icon"]').count() === 1);
  ok('the bar is there', await p.locator('.ins').isVisible());
  ok('and it offers to show how, not to install', (await p.locator('.ins .go').innerText()) === 'How');
  await p.locator('.ins .go').click();
  await p.waitForTimeout(300);
  const steps = await p.locator('.ins .steps').innerText();
  ok('the steps name the Share button', /share/i.test(steps), steps.split('\n')[0]);
  ok('and Add to Home Screen', /add to home screen/i.test(steps));
  await p.screenshot({ path: 'shots/install-ios.png' });
  ok('it can be dismissed', await (async () => {
    await p.locator('.ins .x').click();
    await p.waitForTimeout(200);
    return (await p.locator('.ins').count()) === 0;
  })());
  await ctx.close();
}

console.log('\nOn Android');
{
  const { p, ctx } = await open(ANDROID);
  // Playwright's Chromium does not fire beforeinstallprompt, so the button is
  // correctly absent — offering an Install that might do nothing is worse than
  // offering none. Firing the event by hand proves the wiring.
  ok('nothing is offered until the browser says it can', await p.locator('.ins').count() === 0);
  await p.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await p.waitForTimeout(300);
  ok('once it does, the bar appears', await p.locator('.ins').isVisible());
  ok('and it says Install', (await p.locator('.ins .go').innerText()) === 'Install');
  await p.screenshot({ path: 'shots/install-android.png' });
  await p.locator('.ins .go').click();
  await p.waitForTimeout(300);
  ok('tapping it opens the real install dialog', await p.evaluate(() => window.__prompted === true));
  await ctx.close();
}

console.log('\nOnce it is installed');
{
  const { p, ctx } = await open(ANDROID, { standalone: true });
  ok('no bar telling them to install what they installed',
    await p.locator('.ins').count() === 0);
  await ctx.close();
}

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
