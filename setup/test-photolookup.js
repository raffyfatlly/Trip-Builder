// Offline check of the photo path. No agent, no build, no API cost.
//
// Commons itself is unreachable from the dev sandbox, so the network call is
// stubbed with a real captured response shape. What this proves is the part
// that broke before: that a response is parsed into usable URLs, that anything
// not a hotlinkable Wikimedia image is dropped rather than rendered broken,
// and that add_photos actually lands the key on the right stay/item/feature.

import { findPhotos } from '../lib/photos.js';
import { applyEdit } from '../lib/itinerary.js';

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

const page = (title, thumb, url, desc) => ({
  title: 'File:' + title,
  imageinfo: [{
    thumburl: thumb, url,
    extmetadata: {
      ImageDescription: { value: desc },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      Artist: { value: '<a href="/wiki/User:X">Someone</a>' },
    },
  }],
});

const real = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Dragon.jpg/1200px-Dragon.jpg';

const responses = {
  'Dragon Bridge Da Nang': { query: { pages: {
    1: page('Dragon.jpg', real, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Dragon.jpg',
            'The <b>Dragon   Bridge</b> at night'),
    // A PDF and an off-host URL: both must be dropped.
    2: page('Leaflet.pdf', 'https://upload.wikimedia.org/wikipedia/commons/x/leaflet.pdf', null, 'a pdf'),
    3: page('Hotel.jpg', 'https://cdn.booking.com/hotel.jpg', 'https://cdn.booking.com/hotel.jpg', 'off host'),
  } } },
  'Nowhere At All': { query: { pages: {} } },
};

global.fetch = async (url) => {
  const term = decodeURIComponent(new URL(url).searchParams.get('gsrsearch'));
  if (term === 'boom') return { ok: false, status: 500 };
  return { ok: true, json: async () => responses[term] || { query: { pages: {} } } };
};

const text = await findPhotos([
  { key: 'dragonbridge', search: 'Dragon Bridge Da Nang' },
  { key: 'ghost', search: 'Nowhere At All' },
  { key: 'broken', search: 'boom' },
]);
console.log(text + '\n');

check('real image URL returned', text.includes(real));
check('PDF dropped', !text.includes('leaflet.pdf'));
check('off-host URL dropped', !text.includes('booking.com'));
check('HTML stripped from description', text.includes('The Dragon Bridge at night'));
check('licence carried through', text.includes('CC BY-SA 4.0'));
check('empty result says so', text.includes('nothing usable found'));
check('lookup failure reported honestly', text.includes('lookup failed'));
check('never invents a URL for a miss', (text.match(/upload\.wikimedia\.org/g) || []).length === 1);

// The other half: does a found photo actually reach the itinerary?
const base = applyEdit(null, 'save_itinerary', {
  trip: { feature: { title: 'Sunset' } },
  stays: [{ name: 'Furama' }],
  days: [{ items: [{ t: 'Coffee' }, { t: 'Dragon Bridge' }] }],
  ideas: [], areas: [],
});
const after = applyEdit(base, 'add_photos', {
  photos: { dragonbridge: real, beach: real + '#2' },
  attach: [
    { key: 'dragonbridge', target: 'item', day: 0, id: 'b0-1', credit: 'Dragon Bridge', licence: 'CC BY-SA 4.0' },
    { key: 'beach', target: 'stay', stay: 0, credit: 'My Khe beach' },
    { key: 'beach', target: 'feature', credit: 'My Khe beach' },
    { key: 'missing', target: 'stay', stay: 0 },
  ],
});
check('item photo attached to the right item', after.days[0].items[1].photo === 'dragonbridge');
check('other item untouched', !after.days[0].items[0].photo);
check('stay photo attached', after.stays[0].photo === 'beach');
check('feature photo attached', after.trip.feature.photo === 'beach');
check('credit carried', after.days[0].items[1].credit === 'Dragon Bridge');
check('unknown key ignored', after.stays[0].photo === 'beach');

// A rebuild must not throw away photos that cost real money to find.
const rebuilt = applyEdit(after, 'save_itinerary', { trip: {}, stays: [], days: [], ideas: [], areas: [] });
check('photos survive a rebuild', Object.keys(rebuilt.photos).length === 2);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
