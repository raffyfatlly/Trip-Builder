// Offline check of the photo path. No agent, no build, no API cost.
//
// Commons and Openverse are both unreachable from the dev sandbox (403 at the
// egress proxy), so the network is stubbed. What this proves is the part that
// broke before: that responses are parsed into usable URLs, that a URL which
// does not actually serve an image is dropped rather than rendered broken, and
// that add_photos lands the key on the right stay/item/feature.

import { findPhotos, mapFor, lookupLink } from '../lib/photos.js';
import { applyEdit } from '../lib/itinerary.js';

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

const commonsPage = (title, thumb, desc) => ({
  title: 'File:' + title,
  imageinfo: [{
    thumburl: thumb, url: thumb,
    extmetadata: {
      ImageDescription: { value: desc },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      Artist: { value: '<a href="/wiki/User:X">Someone</a>' },
    },
  }],
});

const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Dragon.jpg/1200px-Dragon.jpg';
const FLICKR = 'https://live.staticflickr.com/65535/furama-resort.jpg';
const DEAD = 'https://example.com/gone.jpg';
const NOTIMAGE = 'https://example.com/page.html';

// Pages the og:image lookup will be pointed at; filled in further down.
let PAGES = {};

// Only these serve an image; everything else 404s or serves HTML.
const SERVES = { [WIKI]: 'image/jpeg', [FLICKR]: 'image/jpeg', 'https://mine.example/hotel.jpg': 'image/jpeg' };

global.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const u = String(url);

  if (PAGES[u] !== undefined) {
    return { ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => PAGES[u] };
  }
  if (u.startsWith('https://gone.example')) return { ok: false, status: 404, headers: new Headers() };

  if (u.startsWith('https://commons.wikimedia.org')) {
    const term = decodeURIComponent(new URL(u).searchParams.get('gsrsearch'));
    if (term === 'boom') return { ok: false, status: 500, headers: new Map() };
    const pages = term.includes('Dragon')
      ? { 1: commonsPage('Dragon.jpg', WIKI, 'The <b>Dragon   Bridge</b> at night') }
      : {};
    return { ok: true, headers: new Headers(), json: async () => ({ query: { pages } }) };
  }

  if (u.startsWith('https://api.openverse.org')) {
    const q = new URL(u).searchParams.get('q');
    if (q === 'boom') return { ok: false, status: 503, headers: new Headers() };
    const results = q.includes('Furama')
      ? [{ title: 'Furama Resort Da Nang pool', url: FLICKR, creator: 'A Photographer',
           license: 'by', license_version: '2.0', tags: [{ name: 'hotel' }, { name: 'da nang' }] },
         { title: 'Broken one', url: DEAD, creator: '', license: 'by', tags: [] }]
      : [];
    return { ok: true, headers: new Headers(), json: async () => ({ results }) };
  }

  // Everything else is a URL being checked.
  const type = SERVES[u];
  if (!type) {
    if (u === NOTIMAGE) return { ok: true, headers: new Headers({ 'content-type': 'text/html' }) };
    return { ok: false, status: 404, headers: new Headers() };
  }
  // One host that refuses HEAD, to prove the GET fallback saves a good photo.
  if (method === 'HEAD' && u === FLICKR) return { ok: false, status: 405, headers: new Headers() };
  return { ok: true, headers: new Headers({ 'content-type': type }) };
};

const text = await findPhotos([
  { key: 'dragonbridge', search: 'Dragon Bridge Da Nang' },
  { key: 'furama', search: 'Furama Resort Da Nang' },
  { key: 'ghost', search: 'Nowhere At All' },
  { key: 'broken', search: 'boom' },
  { key: 'theirs', url: 'https://mine.example/hotel.jpg' },
  { key: 'theirdud', url: NOTIMAGE },
]);
console.log(text + '\n');

check('Commons result returned', text.includes(WIKI));
check('Openverse finds the actual hotel', text.includes(FLICKR));
check('a host that refuses HEAD still works', text.includes('Furama Resort Da Nang pool'));
check('a dead URL is dropped', !text.includes(DEAD));
check('HTML served as a photo is dropped', !text.includes(NOTIMAGE));
check('their own URL passes straight through', text.includes('https://mine.example/hotel.jpg'));
check('a bad URL of theirs is called out', text.includes('did not return an image'));
check('HTML stripped from descriptions', text.includes('The Dragon Bridge at night'));
check('licence carried through', text.includes('CC BY-SA 4.0') && text.includes('BY 2.0'));
check('empty result says so', text.includes('nothing usable found'));
check('both sources failing is reported', text.includes('lookup failed'));
check('never invents a URL for a miss', (text.match(/https:\/\//g) || []).length === 3);

// --- the hotel's own website, which is the only reliable hotel photo -------
const HOTELIMG = 'https://cdn.furama.example/hero.jpg';
PAGES = {
  'https://furama.example/': `<html><head><title>Furama Resort Da Nang</title>
     <meta property="og:image" content="${HOTELIMG}"></head><body>…</body></html>`,
  'https://nometa.example/': '<html><head><title>Nothing here</title></head><body>x</body></html>',
  'https://relative.example/': '<html><head><meta property="og:image" content="/img/pool.jpg"></head></html>',
};
SERVES[HOTELIMG] = 'image/jpeg';
SERVES['https://relative.example/img/pool.jpg'] = 'image/jpeg';

const page = await findPhotos([
  { key: 'hotel', search: 'Furama Resort Da Nang', page: 'https://furama.example/' },
  { key: 'nometa', page: 'https://nometa.example/' },
  { key: 'rel', page: 'https://relative.example/' },
  { key: 'dead', page: 'https://gone.example/', search: 'Dragon Bridge Da Nang' },
]);
check("a hotel's own photo is found from its site", page.includes(HOTELIMG));
check('and credited to the site it came from', page.includes('furama.example'));
check('a page with no image says so', page.includes('no usable main image'));
check('a relative image URL is resolved', page.includes('https://relative.example/img/pool.jpg'));
check('an unreachable page falls back to the search', page.includes(WIKI));
check('the page beats the search when both work', page.indexOf(HOTELIMG) < page.indexOf('nometa'));

// --- and when there is no photograph at all -------------------------------
check('a map stands in for a missing photo',
  mapFor(16.0544, 108.2022) === 'https://maps.wikimedia.org/img/osm-intl,15,16.0544,108.2022,640x360.png');
check('but never invented without coordinates', mapFor(null, undefined) === null && mapFor('a', 'b') === null);
check('and there is always somewhere to go and look',
  lookupLink('Furama Resort', 'Da Nang') === 'https://www.google.com/maps/search/Furama%20Resort%20Da%20Nang');

// The other half: does a found photo actually reach the itinerary?
const base = applyEdit(null, 'save_itinerary', {
  trip: { feature: { title: 'Sunset' } },
  stays: [{ name: 'Furama' }],
  days: [{ items: [{ t: 'Coffee' }, { t: 'Dragon Bridge' }] }],
  ideas: [], areas: [],
});
const after = applyEdit(base, 'add_photos', {
  photos: { dragonbridge: WIKI, hotel: FLICKR },
  attach: [
    { key: 'dragonbridge', target: 'item', day: 0, id: 'b0-1', credit: 'Dragon Bridge', licence: 'CC BY-SA 4.0' },
    { key: 'hotel', target: 'stay', stay: 0, credit: 'Furama pool' },
    { key: 'hotel', target: 'feature', credit: 'Furama pool' },
    { key: 'missing', target: 'stay', stay: 0 },
  ],
});
check('item photo attached to the right item', after.days[0].items[1].photo === 'dragonbridge');
check('other item untouched', !after.days[0].items[0].photo);
check('stay photo attached', after.stays[0].photo === 'hotel');
check('feature photo attached', after.trip.feature.photo === 'hotel');
check('credit carried', after.days[0].items[1].credit === 'Dragon Bridge');
check('unknown key ignored', after.stays[0].photo === 'hotel');

const rebuilt = applyEdit(after, 'save_itinerary', { trip: {}, stays: [], days: [], ideas: [], areas: [] });
check('photos survive a rebuild', Object.keys(rebuilt.photos).length === 2);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
