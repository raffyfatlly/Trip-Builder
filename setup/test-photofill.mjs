// Every place in the trip gets a picture.
//
// raffy, 2026-09-02: "in the app, i want all places mention (ideas , itenary ,
// hotels) all have photos."
//
// The builder attaches one where it happens to look one up — across his three
// real trips that came to 10, 14 and 7 out of thirty-odd places, with Explore
// cards blank on a tab that is browsed by picture. Asking the builder to try
// harder is the move that has failed all day, so the app fills the gaps itself.
//
// What these tests are really guarding is the BILL: only real places, paid for
// once, bounded per pass.
//
//   node setup/test-photofill.mjs

import { photoGaps, applyFill, fillKey, fillPhotoGaps, fillWhere, localise as _localise, placeNameFrom } from '../lib/photos.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// Shaped after his Desaru trip, logistics rows and all.
const TRIP = {
  trip: { title: 'Desaru Coast' },
  stays: [
    { n: 'Mandarin Oriental, Desaru Coast' },
    // A picture and a position: nothing left to buy.
    { n: 'Anantara Desaru', photo: 'has-one', lat: 1.5551, lon: 104.2626 },
    // A picture but nobody knows where it is, which is the case the map needs
    // and the one that used to be skipped.
    { n: 'Westin Desaru Coast', photo: 'has-one' },
  ],
  ideas: [{ n: 'Turmeric at Anantara' }, { n: 'Desaru Seafood Corner' }],
  days: [
    { items: [
      { h: 'Drive to Desaru' }, { h: 'Check in' }, { h: 'Desaru Fruit Farm' },
      { h: 'Early night' }, { h: 'Dinner at Desaru Seafood Corner' },
    ] },
    { items: [
      { h: 'Back to the pool' }, { h: 'Check out' }, { h: 'Adventure Waterpark' },
      { h: 'Drive home' }, { h: 'Turmeric at Anantara' },
    ] },
  ],
  photos: { 'has-one': 'https://img.test/anantara.jpg' },
};

{
  const gaps = photoGaps(TRIP).map((g) => g.name);
  console.log('');
  ok('the hotel with no picture is a gap', gaps.includes('Mandarin Oriental, Desaru Coast'));
  ok('so are the Explore ideas',
     gaps.includes('Turmeric at Anantara') && gaps.includes('Desaru Seafood Corner'));
  ok('and real places in the days', gaps.includes('Desaru Fruit Farm') && gaps.includes('Adventure Waterpark'));

  // The bill lives here. Every one of these would be a billed lookup returning
  // nothing anybody wants to look at.
  for (const junk of ['Drive to Desaru', 'Check in', 'Check out', 'Early night', 'Back to the pool', 'Drive home']) {
    ok('"' + junk + '" is not paid for', !gaps.includes(junk));
  }
  ok('a place with a picture and a position is not paid for again',
     !gaps.includes('Anantara Desaru'));
  // The map cannot draw what has no coordinates, and this lookup returns them
  // in the same response as the photo. Skipping it is what kept everything
  // except hotels off the map.
  ok('but one with a picture and no position still is',
     gaps.includes('Westin Desaru Coast'));

  // Descriptions of an afternoon, taken verbatim from his three real trips.
  // Every one would have been a billed lookup returning nothing.
  const desc = photoGaps({ days: [{ items: [
    { h: 'Beach and pool' }, { h: 'Early dinner, easy night' },
    { h: 'Villa plunge pool, then the beach' }, { h: 'Easy morning at the apartment' },
    { h: 'Dinner — seafood or vegetable Italian' }, { h: 'Rooftop or terrace sunset aperitivo' },
  ] }] }).map((g) => g.name);
  ok('a description of an afternoon is not a place', desc.length === 0, desc.join(' | '));

  // And the ones that look similar but are real must survive it.
  const real = photoGaps({ days: [{ items: [
    { h: 'Marina Grande, Sorrento' }, { h: 'Satay by the Bay' },
    { h: 'Last Mandarin Oriental morning' }, { h: 'Adventure Waterpark' },
  ] }] }).map((g) => g.name);
  ok('but a real name with a comma in it survives', real.length === 4, real.join(' | '));

  // "Dinner at Desaru Seafood Corner" and the idea "Desaru Seafood Corner" are
  // the same restaurant twice. One lookup, not two.
  ok('the same place twice is one lookup',
     photoGaps(TRIP).filter((g) => /seafood corner/i.test(g.key)).length === 1,
     photoGaps(TRIP).map((g) => g.key).join(' | '));
}

// --- what a paid answer does once it exists ---------------------------------
{
  console.log('');
  const fill = {
    [fillKey('Mandarin Oriental, Desaru Coast')]: '/api/photo?ref=places/x/photos/y',
    [fillKey('Turmeric at Anantara')]: '/api/photo?ref=places/a/photos/b',
    [fillKey('Desaru Fruit Farm')]: '',      // Google knows no picture: remembered as a miss
  };
  const filled = applyFill(TRIP, fill);
  ok('the hotel gets its picture', !!filled.stays[0].photo);
  ok('and the URL lands in the photos map', !!filled.photos[filled.stays[0].photo]);
  ok('an Explore idea gets one', !!filled.ideas[0].photo);
  ok('a place Google has no picture of stays blank',
     !filled.days[0].items[2].photo);
  ok('and what the builder chose is untouched', filled.stays[1].photo === 'has-one');
  ok('logistics stay blank', !filled.days[0].items[0].photo && !filled.days[1].items[1].photo);
}

// --- and the coordinates, which are what put anything but a hotel on the map -
{
  console.log('');
  const fill = {
    [fillKey('Turmeric at Anantara')]: { u: '/api/photo?ref=places/a/photos/b', lat: 1.5551, lon: 104.2626, done: 1 },
    [fillKey('Desaru Fruit Farm')]: { u: '', lat: 1.6, lon: 104.1, done: 1 },
    // Written before coordinates were kept. Still a valid photo, no position.
    [fillKey('Mandarin Oriental, Desaru Coast')]: '/api/photo?ref=places/x/photos/y',
  };
  const filled = applyFill(TRIP, fill);
  ok('an idea learns where it is', filled.ideas[0].lat === 1.5551 && filled.ideas[0].lon === 104.2626);
  ok('so does a day item', filled.days[0].items[2].lat === 1.6);
  ok('a place with no picture still gets its position',
     !filled.days[0].items[2].photo && isFinite(filled.days[0].items[2].lon));
  ok('an entry from before this still works, with no position',
     !!filled.stays[0].photo && filled.stays[0].lat === undefined);
  ok('and fillWhere reads it back',
     (fillWhere(fill, 'Turmeric at Anantara') || {}).lat === 1.5551 &&
     fillWhere(fill, 'Mandarin Oriental, Desaru Coast') === null);

  // Applying it again must not multiply keys — this runs on every read.
  const twice = applyFill(filled, fill);
  ok('applying it twice changes nothing', Object.keys(twice.photos).length === Object.keys(filled.photos).length);
  ok('and it is a no-op with an empty store', applyFill(TRIP, {}) === TRIP);
}

// --- the money guards --------------------------------------------------------
{
  console.log('');
  // No key configured: it must not throw, and it must not invent anything.
  delete process.env.GOOGLE_PLACES_KEY;
  delete process.env.GOOGLE_MAPS_KEY;
  const same = { a: 'x' };
  ok('with no Places key it buys nothing', (await fillPhotoGaps(TRIP, same)) === same);

  // Everything already known: no lookups, same object back.
  const all = Object.fromEntries(photoGaps(TRIP).map((g) => [g.key, '']));
  const after = await fillPhotoGaps(TRIP, all);
  ok('a second pass over the same trip buys nothing',
     Object.keys(after).length === Object.keys(all).length);
}


// --- what the Hanoi run on 2026-09-05 showed --------------------------------
//
// Reading the shared place cache after a real two-city build turned up billed
// Places searches for "check back in to la siesta classic hang thung hanoi ninh
// binh" and "browse dong xuan market hanoi ninh binh". Two separate faults in
// one string: a heading that is an instruction being treated as a place name,
// and a two-city trip title being appended to every query.


const hanoi = { days: [{ items: [
  { h: 'Check back in to La Siesta Classic Hang Thung' },
  { h: 'Browse Dong Xuan Market' },
  { h: 'Head back to Hanoi' },
  { h: 'Return to the Old Quarter' },
  { h: 'Dinner at Bun Cha Huong Lien' },
  { h: 'Temple of Literature' },
] }] };
const names = photoGaps(hanoi).map((g) => g.name);

ok('"check back in to X" is not bought as a place', !names.some((n) => /^Check back/i.test(n)));
ok('nor "head back to"', !names.some((n) => /^Head back/i.test(n)));
ok('nor "return to"', !names.some((n) => /^Return to/i.test(n)));
ok('"browse X" is bought as X', photoGaps(hanoi).some((g) => g.key === 'dong xuan market'));
ok('a real name still goes through', names.includes('Temple of Literature'));

ok('a one-city trip still qualifies its lookups', _localise('Chiang Mai') === 'Chiang Mai');
ok('a two-city trip qualifies nothing', _localise('Hanoi & Ninh Binh') === '');
ok('nor does one written with a comma', _localise('Hanoi, Ninh Binh') === '');
ok('nor with an arrow', _localise('Hanoi → Ninh Binh') === '');


// --- the place inside the heading ------------------------------------------
//
// Every string here is one the fill actually sent to Google on 2026-09-05,
// billed at $0.032 each. The heading was being sent whole: only the cache key
// was ever cleaned up, so the saving was imaginary.

const CASES = [
  ['Egg coffee at Café Giảng', 'Café Giảng'],
  ['Boat ride through Tam Coc', 'Tam Coc'],
  ['Walk Hoan Kiem Lake', 'Hoan Kiem Lake'],
  ['Browse Dong Xuan Market', 'Dong Xuan Market'],
  ['Lunch around Truc Bach', 'Truc Bach'],
  ['Lunch: bún chả at Hương Liên', 'Hương Liên'],
  ['Last Old Quarter dinner', 'Old Quarter'],
  ['Food-heavy evening back in the Old Quarter', 'Old Quarter'],
  ['Trang An boat ride', 'Trang An'],
  // Left alone: these are already names, and "of" is not a preposition that
  // splits a place from what you do there.
  ['Temple of Literature', 'Temple of Literature'],
  ['Bún chả Hương Liên', 'Bún chả Hương Liên'],
  ['Hoa Lu Ancient Capital', 'Hoa Lu Ancient Capital'],
  ['Tran Quoc Pagoda, West Lake', 'Tran Quoc Pagoda, West Lake'],
  // A restaurant inside a resort. There is no activity word here, so the whole
  // string stays: "Anantara" alone would find the wrong door.
  ['Turmeric at Anantara', 'Turmeric at Anantara'],
  ['Thang Long Water Puppet Theatre', 'Thang Long Water Puppet Theatre'],
];
for (const [raw, want] of CASES) {
  ok(JSON.stringify(raw) + ' -> ' + JSON.stringify(want), placeNameFrom(raw) === want,
    placeNameFrom(raw) === want ? '' : 'got ' + JSON.stringify(placeNameFrom(raw)));
}

ok('and it is the extracted name that gets looked up, not the heading', (() => {
  const g = photoGaps({ days: [{ items: [{ h: 'Egg coffee at Café Giảng' }] }] });
  return g.length === 1 && g[0].name === 'Café Giảng';
})());

ok('the whole Hanoi day costs fewer lookups than it has headings', (() => {
  const raw = CASES.map(([r]) => r).concat(['Check back in to La Siesta Classic Hang Thung']);
  return photoGaps({ days: [{ items: raw.map((h) => ({ h })) }] }).length < raw.length;
})());

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
