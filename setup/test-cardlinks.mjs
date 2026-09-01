// Pictures and links on the cards in the chat.
//
// raffy, 2026-09-01: "when discussing option, locations etc , i need pictures .
// and I need the direct link to the think so i don't have to go out the app and
// type. u know what I mean? we want them to be in our app as much as possible.
// the link must be there. map is not that important actually. but any info or
// links related to the suggested place is important."
//
// Two things this guards. The picture is fetched by the card from /api/place,
// not supplied by the agent — there is no free Google Images API and an image
// URL lifted from a search result usually blocks hotlinking on a phone. And
// every link the agent found has to survive onto the card, with the map last,
// because the whole point is not having to leave and type the name again.
//
//   BASE=http://localhost:3220 node setup/test-cardlinks.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { blockFrom } from '../lib/blocks.js';

const B = process.env.BASE || 'http://localhost:3220';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const OPTIONS = {
  kind: 'options', title: 'Three places in An Thuong', choose: true,
  items: [
    {
      name: 'Furama Resort Danang',
      why: 'Three pools and its own beach.',
      price: 'RM480/night',
      source: 'top of r/VietnamTravel this year',
      links: [
        { label: 'Book on Agoda', url: 'https://agoda.test/furama' },
        { label: 'Their site', url: 'https://furama.test/' },
        { label: 'The Reddit thread', url: 'https://reddit.test/r/vietnam/furama' },
      ],
    },
    // The single-link form still has to work: it is what the agent sent before
    // `links` existed, and it is still in old transcripts.
    { name: 'TIA Wellness', why: 'Quieter, all-inclusive spa.', link: 'https://tia.test/' },
  ],
};

const SPOTS = {
  kind: 'spots', title: 'What people are photographing',
  spots: [{
    name: 'Golden Bridge',
    buzz: 'The stone hands. Everyone shoots it from the far end.',
    source: 'a TikTok with 400k views',
    links: [{ label: 'The TikTok', url: 'https://tiktok.test/goldenbridge' }],
  }],
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const asked = [];
await ctx.route('**/api/session', (r) => r.fulfill({ json: { session: 'sesn_L' } }));
await ctx.route('**/api/me', (r) => r.fulfill({ json: { accounts: false, user: null } }));
await ctx.route('**/api/place**', (r) => {
  asked.push(decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || ''));
  r.fulfill({ json: {
    photo: '/api/photo?ref=places/x/photos/y',
    rating: '4.6 on Google, 2,300 reviews',
    site: 'https://furama.test/',            // the same site the agent gave
    maps: 'https://maps.google.test/place/furama',
  } });
});
await ctx.route('**/api/photo**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
await ctx.route('**/api/state**', (r) => r.fulfill({ json: {
  transcript: [
    { role: 'user', text: 'where should we stay', id: 'u1' },
    { ...blockFrom({ id: 'b1', name: 'present', input: OPTIONS }) },
    { ...blockFrom({ id: 'b2', name: 'present', input: SPOTS }) },
  ],
  itinerary: null, plan: {}, agentEdits: [], memoryOps: [],
  building: false, thinking: false, turns: 1 } }));

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('itin.session.v1', 'sesn_L'));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const first = page.locator('.opt').first();

ok('every card gets a picture', (await page.locator('.opt .pic img').count()) === 3);
ok('and it comes from our own proxy, not a scraped URL',
   (await first.locator('.pic img').getAttribute('src')).startsWith('/api/photo?'));
ok('the card asks for it by name and place', asked.some((q) => q.startsWith('Furama Resort Danang')), asked.join(' | '));

const links = first.locator('.links a');
ok('every link the agent found is there', (await links.count()) === 4, (await links.count()) + ' links');
const labels = await links.allInnerTexts();
ok('in the order they would be opened', labels.join(' / ').startsWith('Book on Agoda / Their site / The Reddit thread'), labels.join(' / '));
ok('and the map is last', labels[labels.length - 1].trim() === 'Map');
ok('the map link is the real place, not a search',
   (await links.last().getAttribute('href')) === 'https://maps.google.test/place/furama');

// The agent and Places usually land on the same page; twice reads as a bug.
const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
ok('a link found twice is only shown once', new Set(hrefs).size === hrefs.length, hrefs.join(' | '));

// styled-jsx scopes by the component that declares the rules, so moving this
// markup into its own component silently unstyled it — the row lost its layout
// and every icon rendered at its natural size, which is enormous.
const icon = await links.first().locator('svg').boundingBox();
ok('the links row is actually styled', icon && icon.width < 20 && icon.height < 20,
   icon ? Math.round(icon.width) + '×' + Math.round(icon.height) : 'no icon');
ok('and it sits on one row per line, not stacked huge',
   (await links.first().boundingBox()).height < 30);

ok('where the recommendation came from is shown',
   (await first.locator('.src').innerText()).includes('r/VietnamTravel'));

// The old single-link shape still has to render.
const second = page.locator('.opt').nth(1);
const l2 = await second.locator('.links a').allInnerTexts();
ok('a card with only the old link field still works', l2[0].trim() === 'Their site', l2.join(' / '));
// Places knows a site too. Two links called "Their site" reads as a bug even
// when both work, so it is only added when nothing on the card shares its host.
ok('and Google\'s copy of it is not added twice', l2.filter((t) => t.trim() === 'Their site').length === 1, l2.join(' / '));

// Spots get the same treatment.
const spot = page.locator('.opt.spot').first();
ok('a viral spot gets its picture too', (await spot.locator('.pic img').count()) === 1);
ok('and the post it came from', (await spot.locator('.links a').first().innerText()).includes('TikTok'));
ok('with the source named', (await spot.locator('.src').innerText()).includes('400k'));

ok('no horizontal overflow at 390px',
   (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
ok('no page errors', errs.length === 0, errs.join(' / '));

await page.screenshot({ path: '/home/user/claude/tools/itinerary-chat/shots/cardlinks.png', fullPage: false });
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
